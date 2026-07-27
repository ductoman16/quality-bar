import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import {
  verifyPublicRepositoryRead,
  verifyRepositoryRead,
} from "../src/repository-git.js";
import { RepositoryError } from "../src/repository-validation.js";

/** @param {string} directory @param {string} name @param {boolean} populated */
function createBareRepository(directory, name, populated) {
  const repository = join(directory, `${name}.git`);
  if (populated) {
    const source = join(directory, `${name}-source`);
    execFileSync("git", ["init", "--initial-branch=main", source], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", source, "config", "user.name", "Quality Bar"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", source, "config", "user.email", "quality-bar@example.invalid"],
      { stdio: "ignore" },
    );
    execFileSync(
      "git",
      ["-C", source, "commit", "--allow-empty", "-m", "fact"],
      {
        stdio: "ignore",
      },
    );
    execFileSync("git", ["clone", "--bare", source, repository], {
      stdio: "ignore",
    });
  } else {
    execFileSync("git", ["init", "--bare", repository], { stdio: "ignore" });
  }
  execFileSync("git", ["--git-dir", repository, "update-server-info"], {
    stdio: "ignore",
  });
}

test("public Repository verification performs a non-mutating read over real HTTPS Git", async (context) => {
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
  const server = createServer(
    {
      cert: readFileSync(certificate),
      key: readFileSync(key),
    },
    (request, response) => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "https://127.0.0.1").pathname,
      );
      if (pathname.startsWith("/private.git/")) {
        const authorization = request.headers.authorization ?? "";
        privateAuthorizationHeaders.push(authorization);
        if (
          authorization !==
          `Basic ${Buffer.from("operator:private-token-value").toString("base64")}`
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
  await verifyRepositoryRead(
    `https://127.0.0.1:${address.port}/private.git`,
    {
      token: "private-token-value",
      username: "operator",
    },
    { certificateAuthorityPath: certificate },
  );
  assert.deepEqual(privateAuthorizationHeaders, [
    "",
    "",
    `Basic ${Buffer.from("operator:private-token-value").toString("base64")}`,
    `Basic ${Buffer.from("operator:private-token-value").toString("base64")}`,
  ]);
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
});
