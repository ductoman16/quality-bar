import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { verifyPublicRepositoryRead } from "../src/repository-git.js";
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
  const server = createServer(
    {
      cert: readFileSync(certificate),
      key: readFileSync(key),
    },
    (request, response) => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "https://127.0.0.1").pathname,
      );
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
  const environment = { GIT_SSL_NO_VERIFY: "1" };

  await verifyPublicRepositoryRead(
    `https://127.0.0.1:${address.port}/populated.git`,
    { environment },
  );
  await verifyPublicRepositoryRead(
    `https://127.0.0.1:${address.port}/empty.git`,
    { environment },
  );
  await assert.rejects(
    () =>
      verifyPublicRepositoryRead(
        `https://127.0.0.1:${address.port}/missing.git`,
        { environment },
      ),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
});
