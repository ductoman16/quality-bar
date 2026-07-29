import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositorySelectorResolver } from "../src/repository-selector.js";

const request = {
  base: { type: "branch", value: "main" },
  head: { type: "branch", value: "topic" },
};

test("Forge Repository selector acquisition uses its owning Connection credential", async () => {
  /** @type {any[]} */
  const observed = [];
  const resolver = createRepositorySelectorResolver({
    credentialCipher: /** @type {any} */ ({}),
    find: () => ({}),
    objectDatabaseRoot: "/owned/checkouts",
    requireAcceptsNewWork: () => ({
      api_url: "https://api.github.com/repos/operator/private",
      assignment_count: 0,
      credential_type: "forge_connection",
      deletion_eligible: false,
      forge_connection_id: "connection-1",
      forge_repository_id: 101,
      health: "healthy",
      health_error: null,
      id: "repository-1",
      lifecycle: "enabled",
      name: "operator/private",
      provider: "github",
      url: "https://github.com/operator/private.git",
      verification_id: "verification-1",
      verified_at: 1,
      web_url: "https://github.com/operator/private",
    }),
    async resolveForgeCredential(connectionId, provider) {
      observed.push(["credential", connectionId, provider]);
      return {
        token: "short-lived-installation-token",
        username: "x-access-token",
      };
    },
    async resolveSelectors(url, credential, selectors, options) {
      observed.push(["selectors", url, credential, selectors, options]);
      return {
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(40),
      };
    },
  });

  assert.deepEqual(await resolver("repository-1", request), {
    base_commit: "1".repeat(40),
    head_commit: "2".repeat(40),
  });
  assert.deepEqual(observed, [
    ["credential", "connection-1", "github"],
    [
      "selectors",
      "https://github.com/operator/private.git",
      {
        token: "short-lived-installation-token",
        username: "x-access-token",
      },
      request,
      { objectDatabaseRoot: "/owned/checkouts" },
    ],
  ]);
});

test("provider credential failures remain exact hard-unavailable failures", async () => {
  const resolver = createRepositorySelectorResolver({
    credentialCipher: /** @type {any} */ ({}),
    find: () => ({}),
    objectDatabaseRoot: "/owned/checkouts",
    requireAcceptsNewWork: () =>
      /** @type {any} */ ({
        forge_connection_id: "connection-1",
        provider: "forgejo",
        url: "https://forgejo.example/operator/private.git",
      }),
    resolveForgeCredential() {
      throw Object.assign(new Error("Forgejo dependency is unavailable"), {
        code: "forgejo_repository_api_access_failed",
      });
    },
    resolveSelectors() {
      throw new Error("selectors must not run");
    },
  });

  await assert.rejects(
    () => resolver("repository-1", request),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_repository_api_access_failed" &&
      "unavailable" in error &&
      error.unavailable === true,
  );
});
