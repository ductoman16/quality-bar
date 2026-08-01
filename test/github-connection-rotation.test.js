import assert from "node:assert/strict";
import { test } from "node:test";

import { rotateGitHubConnection } from "../src/github-connection-rotation.js";
import { GitHubConnectionError } from "../src/github-connection.js";

test("GitHub App rotation rejects every non-canonical credential request", async () => {
  const dependencies = /** @type {any} */ ({
    cipher: {},
    createId: () => "verification-1",
    durableCore: {},
    now: () => 1_000,
    polling: {},
    read: () => null,
    verifier: {},
  });
  for (const input of [
    null,
    {},
    { pem: "" },
    { pem: "replacement", extra: true },
    { pem: 42 },
  ]) {
    await assert.rejects(
      () => rotateGitHubConnection(dependencies, input),
      (error) =>
        error instanceof GitHubConnectionError &&
        error.code === "github_connection_rotation_request_invalid" &&
        error.message === "GitHub App credential rotation request is invalid",
    );
  }
});
