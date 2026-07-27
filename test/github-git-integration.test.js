import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection-error.js";
import { verifyGitHubRepositoryRead } from "../src/github-git-verification.js";
import { verifyRepositoryRead } from "../src/repository-git.js";

test("real Git distinguishes transient GitHub failure from definitive access loss", async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(request.url?.startsWith("/denied") ? 403 : 503).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(
    () => new Promise((resolve) => server.close(() => resolve(undefined))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  /** @type {typeof verifyRepositoryRead} */
  const verifyGit = (url, credential, options) =>
    verifyRepositoryRead(url, credential, options);
  for (const [path, code] of [
    ["transient", "github_git_verification_failed"],
    ["denied", "github_repository_git_read_failed"],
  ]) {
    await assert.rejects(
      () =>
        verifyGitHubRepositoryRead(
          verifyGit,
          {
            clone_url: `http://127.0.0.1:${address.port}/${path}.git`,
            id: 101,
          },
          "installation-token",
          [101],
        ),
      (error) => error instanceof GitHubConnectionError && error.code === code,
    );
  }
});
