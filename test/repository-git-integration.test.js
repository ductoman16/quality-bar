import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  resolvePushedCommitSelectors,
  verifyPublicRepositoryRead,
  verifyRepositoryRead,
} from "../src/repository-git.js";
import { createRepositoryGuidanceService } from "../src/repository-guidance.js";
import { createRepositoryService } from "../src/repository.js";
import { RepositoryError } from "../src/repository-validation.js";
import { createReviewService } from "../src/review.js";
import { openDurableCore } from "../src/durable-core.js";
import {
  assertCredentialedAcquisitionRejectsRedirect,
  createBareRepository,
} from "./repository-git-integration-support.js";
test("public Repository verification accepts a reactivated installation credential over real HTTPS Git", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-git-https-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  createBareRepository(directory, "populated", true);
  createBareRepository(directory, "empty", false);
  createBareRepository(directory, "private", true);
  const key = join(directory, "server.key");
  const certificate = join(directory, "server.crt");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  /** @type {string[]} */
  const privateAuthorizationHeaders = [];
  let acceptedPrivateCredential = "operator:private-token-value";
  const server = createServer(
    {
      cert: readFileSync(certificate),
      key: readFileSync(key),
    },
    (request, response) => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "https://127.0.0.1").pathname,
      );
      if (pathname.startsWith("/redirect.git/")) {
        response
          .writeHead(302, {
            location: pathname.replace("/redirect.git/", "/private.git/"),
          })
          .end();
        return;
      }
      if (pathname.startsWith("/private.git/")) {
        const authorization = request.headers.authorization ?? "";
        privateAuthorizationHeaders.push(authorization);
        if (
          authorization !==
          `Basic ${Buffer.from(acceptedPrivateCredential).toString("base64")}`
        ) {
          response
            .writeHead(401, { "www-authenticate": 'Basic realm="private"' })
            .end();
          return;
        }
      }
      const path = normalize(join(directory, pathname));
      if (!path.startsWith(`${resolve(directory)}/`)) {
        response.writeHead(404).end();
        return;
      }
      try {
        if (!statSync(path).isFile()) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "content-type":
            extname(path) === ".pack"
              ? "application/octet-stream"
              : "text/plain; charset=utf-8",
        });
        response.end(readFileSync(path));
      } catch {
        response.writeHead(404).end();
      }
    },
  );
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise(undefined));
  });
  context.after(
    () => new Promise((resolvePromise) => server.close(resolvePromise)),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await verifyPublicRepositoryRead(
    `https://127.0.0.1:${address.port}/populated.git`,
    { certificateAuthorityPath: certificate },
  );
  const expectedCommit = execFileSync(
    "git",
    ["--git-dir", join(directory, "populated.git"), "rev-parse", "main"],
    { encoding: "utf8" },
  ).trim();
  assert.deepEqual(
    await resolvePushedCommitSelectors(
      `https://127.0.0.1:${address.port}/populated.git`,
      undefined,
      {
        base: { type: "branch", value: "main" },
        head: { type: "commit", value: expectedCommit },
      },
      { certificateAuthorityPath: certificate, objectDatabaseRoot: directory },
    ),
    { base_commit: expectedCommit, head_commit: expectedCommit },
  );
  await verifyPublicRepositoryRead(
    `https://127.0.0.1:${address.port}/empty.git`,
    { certificateAuthorityPath: certificate },
  );
  await assert.rejects(
    () =>
      verifyPublicRepositoryRead(
        `https://127.0.0.1:${address.port}/private.git`,
        { certificateAuthorityPath: certificate },
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  await assertCredentialedAcquisitionRejectsRedirect(
    `https://127.0.0.1:${address.port}/redirect.git`,
    certificate,
    privateAuthorizationHeaders,
  );
  await verifyRepositoryRead(
    `https://127.0.0.1:${address.port}/private.git`,
    {
      token: "private-token-value",
      username: "operator",
    },
    { certificateAuthorityPath: certificate },
  );
  await assert.rejects(
    () =>
      verifyRepositoryRead(
        `https://127.0.0.1:${address.port}/redirect.git`,
        {
          token: "replacement-private-token",
          username: "replacement-operator",
        },
        {
          certificateAuthorityPath: certificate,
          followRedirects: false,
        },
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  acceptedPrivateCredential = "replacement-operator:replacement-private-token";
  await verifyRepositoryRead(
    `https://127.0.0.1:${address.port}/private.git`,
    {
      token: "replacement-private-token",
      username: "replacement-operator",
    },
    { certificateAuthorityPath: certificate },
  );
  assert.deepEqual(privateAuthorizationHeaders, [
    "",
    "",
    `Basic ${Buffer.from("operator:private-token-value").toString("base64")}`,
    `Basic ${Buffer.from("operator:private-token-value").toString("base64")}`,
    "",
    `Basic ${Buffer.from("replacement-operator:replacement-private-token").toString("base64")}`,
    `Basic ${Buffer.from("replacement-operator:replacement-private-token").toString("base64")}`,
  ]);
  let rejectedCredentialDirectory = "";
  await assert.rejects(
    () =>
      verifyRepositoryRead(
        `https://127.0.0.1:${address.port}/private.git`,
        {
          token: "prefix\u0000sensitive-token",
          username: "operator",
        },
        {
          certificateAuthorityPath: certificate,
          removeDirectory(path) {
            rejectedCredentialDirectory = path;
            rmSync(path, { force: true, recursive: true });
          },
        },
      ),
    (error) => {
      assert.ok(error instanceof RepositoryError);
      assert.equal(error.code, "repository_git_verification_unavailable");
      assert.doesNotMatch(error.message, /sensitive-token|prefix|operator/);
      return true;
    },
  );
  acceptedPrivateCredential = "x-access-token:reactivated-installation-token";
  await verifyRepositoryRead(
    `https://127.0.0.1:${address.port}/private.git`,
    { token: "reactivated-installation-token", username: "x-access-token" },
    { certificateAuthorityPath: certificate },
  );
  assert.match(rejectedCredentialDirectory, /quality-bar-git-read-/);
  await assert.rejects(
    () =>
      verifyPublicRepositoryRead(
        `https://127.0.0.1:${address.port}/missing.git`,
        { certificateAuthorityPath: certificate },
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );

  const configuredDirectory = join(directory, "configured-client");
  execFileSync("git", ["init", configuredDirectory], { stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-C",
      configuredDirectory,
      "config",
      `url.file://${join(directory, "populated.git")}.insteadOf`,
      `https://127.0.0.1:${address.port}/missing.git`,
    ],
    { stdio: "ignore" },
  );
  const originalDirectory = process.cwd();
  process.chdir(configuredDirectory);
  try {
    await assert.rejects(
      () =>
        verifyPublicRepositoryRead(
          `https://127.0.0.1:${address.port}/missing.git`,
          { certificateAuthorityPath: certificate },
        ),
      (error) =>
        error instanceof RepositoryError &&
        error.code === "repository_git_read_failed",
    );
  } finally {
    process.chdir(originalDirectory);
  }

  await assert.rejects(
    () =>
      verifyPublicRepositoryRead(
        `https://127.0.0.1:${address.port}/populated.git`,
        {
          certificateAuthorityPath: certificate,
          removeDirectory() {
            throw new Error("simulated cleanup failure");
          },
        },
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_verification_unavailable",
  );

  const lifecycleCore = openDurableCore(
    join(directory, "repository-lifecycle.sqlite3"),
  );
  const lifecycleRepositories = createRepositoryService(lifecycleCore, {
    createId: () => "repository-lifecycle",
    masterKey: Buffer.alloc(32, 7),
    async verifyRead(url, credential) {
      await verifyRepositoryRead(url, credential, {
        certificateAuthorityPath: certificate,
      });
    },
  });
  await lifecycleRepositories.register({
    url: `https://127.0.0.1:${address.port}/populated.git`,
  });
  const reviews = createReviewService(lifecycleCore, {
    createId: (() => {
      let next = 0;
      return () => `git-assignment-fact-${++next}`;
    })(),
  });
  /** @param {string} name */
  const reviewDefinition = (name) => ({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Keep verified Repository scope exact.",
      },
    ],
    description: "Select only admitted Git Repositories.",
    name,
  });
  const installationWide = reviews.create(
    reviewDefinition("Verified Git installation-wide"),
  );
  const repositorySpecific = reviews.create(
    reviewDefinition("Verified Git Repository"),
  );
  reviews.setAssignment(repositorySpecific.id, {
    repository_ids: ["repository-lifecycle"],
    scope: "repository_set",
  });
  assert.deepEqual(
    reviews.selectForNewEvaluation("repository-lifecycle"),
    [installationWide, repositorySpecific].map((review) => ({
      review_id: review.id,
      review_version_id: review.active_version.id,
    })),
  );
  const guidance = createRepositoryGuidanceService(lifecycleCore).read(
    "repository-lifecycle",
  );
  assert.equal(
    guidance.repository.url,
    `https://127.0.0.1:${address.port}/populated.git`,
  );
  assert.deepEqual(
    guidance.reviews.map(({ id }) => id),
    [installationWide.id, repositorySpecific.id],
  );
  await lifecycleRepositories.setLifecycle("repository-lifecycle", {
    lifecycle: "disabled",
  });
  renameSync(
    join(directory, "populated.git"),
    join(directory, "populated-unavailable.git"),
  );
  await assert.rejects(
    () =>
      lifecycleRepositories.setLifecycle("repository-lifecycle", {
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.deepEqual(lifecycleRepositories.list()[0], {
    credential_type: "none",
    health: "error",
    health_error: {
      code: "repository_git_read_failed",
      message: "Repository Git read verification failed",
    },
    id: "repository-lifecycle",
    lifecycle: "disabled",
    url: `https://127.0.0.1:${address.port}/populated.git`,
  });
  renameSync(
    join(directory, "populated-unavailable.git"),
    join(directory, "populated.git"),
  );
  assert.equal(
    (
      await lifecycleRepositories.setLifecycle("repository-lifecycle", {
        lifecycle: "enabled",
      })
    ).health,
    "healthy",
  );
  lifecycleRepositories.destroy();
  lifecycleCore.close();
});
