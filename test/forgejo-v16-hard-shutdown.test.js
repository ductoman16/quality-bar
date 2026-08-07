import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";
import { runIoOperation } from "../src/io-operation-context.js";
import { forgejoV16OpenApi } from "./forgejo-v16-openapi-support.js";

/** @param {string} path */
function forgejoVerificationBody(path) {
  if (path === "/api/v1/version") {
    return { version: "16.0.4" };
  }
  if (path === "/swagger.v1.json") {
    return forgejoV16OpenApi();
  }
  if (path === "/api/v1/repos/search?page=1&limit=50&private=true") {
    return {
      data: [
        {
          clone_url: "https://forgejo.example/operator/private.git",
          full_name: "operator/private",
          html_url: "https://forgejo.example/operator/private",
          id: 11,
          owner: { id: 7, login: "operator" },
          permissions: { admin: true, pull: true, push: true },
          private: true,
          url: "https://forgejo.example/api/v1/repos/operator/private",
        },
      ],
      ok: true,
    };
  }
  if (path === "/api/v1/repos/operator/private") {
    return {
      id: 11,
      permissions: { admin: true, pull: true, push: true },
    };
  }
  return [];
}

/** @param {ReturnType<typeof createForgejoV16Verifier>} verifier */
function beginVerification(verifier) {
  const workers = new AbortController();
  const completion = /** @type {Promise<any>} */ (
    runIoOperation(workers.signal, () =>
      verifier.verify({
        baseUrl: "https://forgejo.example",
        repositoryIds: [11],
        token: "operator-created-pat",
      }),
    )
  );
  return { completion, workers };
}

test("Forgejo verification preserves hard shutdown during response parsing", async () => {
  const responseBody = Promise.withResolvers();
  const { completion, workers } = beginVerification(
    createForgejoV16Verifier({
      fetch: async () =>
        /** @type {Response} */ ({
          json: () => responseBody.promise,
          ok: true,
        }),
    }),
  );
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  await new Promise((resolve) => setImmediate(resolve));

  workers.abort(failure);
  responseBody.reject(new Error("response stream aborted"));

  await assert.rejects(
    completion,
    (/** @type {unknown} */ error) => error === failure,
  );
});

test("Forgejo verification preserves hard shutdown during private Git read", async () => {
  const gitRead = Promise.withResolvers();
  const { completion, workers } = beginVerification(
    createForgejoV16Verifier({
      fetch: async (input) => {
        const requestUrl = new URL(String(input));
        return new Response(
          JSON.stringify(
            forgejoVerificationBody(requestUrl.pathname + requestUrl.search),
          ),
        );
      },
      verifyGit: () => gitRead.promise,
    }),
  );
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  await new Promise((resolve) => setImmediate(resolve));

  workers.abort(failure);
  gitRead.reject(new Error("repository_git_verification_unavailable"));

  await assert.rejects(
    completion,
    (/** @type {unknown} */ error) => error === failure,
  );
});

test("Forgejo verification preserves a distinct private Git termination failure", async () => {
  const gitRead = Promise.withResolvers();
  const terminationFailure = Object.assign(
    new AggregateError([], "Git process termination failed"),
    { code: "git_termination_failed" },
  );
  const { completion, workers } = beginVerification(
    createForgejoV16Verifier({
      fetch: async (input) => {
        const requestUrl = new URL(String(input));
        return new Response(
          JSON.stringify(
            forgejoVerificationBody(requestUrl.pathname + requestUrl.search),
          ),
        );
      },
      verifyGit: () => gitRead.promise,
    }),
  );
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    { code: "storage_unavailable" },
  );
  await new Promise((resolve) => setImmediate(resolve));

  workers.abort(storageFailure);
  gitRead.reject(terminationFailure);

  await assert.rejects(completion, (error) => error === terminationFailure);
});
