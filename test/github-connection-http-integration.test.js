import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GitHubConnectionError,
  createUnavailableGitHubConnectionService,
} from "../src/github/github-connection.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

const selectionRequestId = "00000000-0000-4000-8000-000000000001";

function connectionService() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    create() {
      return {
        startPolling() {},
        read() {
          calls.push(["read"]);
          return null;
        },
        start() {
          calls.push(["start"]);
          return {
            action: "https://github.com/settings/apps/new?state=manifest-state",
            manifest: { default_events: [], public: false },
            method: "POST",
            state: "manifest-state",
          };
        },
        /** @param {any} input */
        async completeManifest(input) {
          calls.push(["manifest", input]);
          return "https://github.com/apps/quality-bar/installations/new";
        },
        /** @param {any} input */
        async completeInstallation(input) {
          calls.push(["installation", input]);
          return {};
        },
        /** @param {any} input */
        async reactivate(input) {
          calls.push(["reactivate", input]);
          throw new GitHubConnectionError(
            "github_connection_reactivation_unsupported",
            "GitHub Connection must be retired before reactivation",
          );
        },
        /** @param {any} input */
        async rotate(input) {
          calls.push(["rotate", input]);
          throw new GitHubConnectionError(
            "github_connection_rotation_conflict",
            "GitHub App credentials changed during rotation",
          );
        },
        /** @param {any} input */
        async selectRepositories(input) {
          calls.push(["selection", input]);
          return [
            {
              api_url: "https://api.github.com/repos/operator/private",
              assignment_count: 0,
              credential_type: "forge_connection",
              deletion_eligible: true,
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
              verified_at: 1_000,
              web_url: "https://github.com/operator/private",
            },
          ];
        },
        /** @param {unknown} input */
        retire(input) {
          calls.push(["retire", input]);
          throw new GitHubConnectionError(
            "github_connection_repositories_active",
            "GitHub Connection cannot retire while dependent Repositories are enabled or disabled",
          );
        },
        remove() {
          calls.push(["remove"]);
        },
        recordCallbackFailure() {
          return "error-receipt";
        },
        consumeCallbackFailure() {
          return null;
        },
        destroy() {},
      };
    },
  };
}

test("GitHub Connection lifecycle routes preserve the owning mutation and failure status", async () => {
  const service = connectionService();
  const { request } = await startApplication({
    createGitHubConnections: () => service.create(),
  });
  const headers = await authenticatedOperatorHeaders(request);
  const retired = await request("/api/v1/github-connections/lifecycle", {
    body: JSON.stringify({ lifecycle: "retired" }),
    headers,
    method: "PATCH",
  });
  assert.equal(retired.status, 409);
  assert.equal(
    await responseErrorCode(retired),
    "github_connection_repositories_active",
  );
  const deleted = await request("/api/v1/github-connections/lifecycle", {
    body: "{}",
    headers,
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(await deleted.json(), null);
  assert.deepEqual(service.calls.slice(-2), [
    ["retire", { lifecycle: "retired" }],
    ["remove"],
  ]);

  const reactivated = await request("/api/v1/github-connections/reactivate", {
    body: JSON.stringify({ pem: "replacement-private-key" }),
    headers,
    method: "POST",
  });
  assert.equal(reactivated.status, 409);
  assert.equal(
    await responseErrorCode(reactivated),
    "github_connection_reactivation_unsupported",
  );
  assert.deepEqual(service.calls.at(-1), [
    "reactivate",
    { pem: "replacement-private-key" },
  ]);
  const rotated = await request(
    "/api/v1/github-connections/credential/rotate",
    {
      body: JSON.stringify({ pem: "replacement-private-key" }),
      headers,
      method: "POST",
    },
  );
  assert.equal(rotated.status, 409);
  assert.equal(
    await responseErrorCode(rotated),
    "github_connection_rotation_conflict",
  );
  assert.deepEqual(service.calls.at(-1), [
    "rotate",
    { pem: "replacement-private-key" },
  ]);
});

test("GitHub Connection reactivation preserves an unavailable service error", async () => {
  const unavailable = Object.assign(
    new Error("GitHub Connection storage is unavailable"),
    { code: "storage_unavailable" },
  );
  const { request } = await startApplication({
    createGitHubConnections: () =>
      createUnavailableGitHubConnectionService(unavailable),
  });
  const headers = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/github-connections/reactivate", {
    body: JSON.stringify({ pem: "replacement-private-key" }),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 503);
  assert.equal(await responseErrorCode(response), "storage_unavailable");
});

test("canonical HTTP flow starts under operator authority and completes both state-bound redirects without a cross-site cookie", async () => {
  const service = connectionService();
  const { request } = await startApplication({
    createGitHubConnections: () => service.create(),
  });
  const headers = await authenticatedOperatorHeaders(request);
  const start = await request("/api/v1/github-connections/manifest", {
    body: "{}",
    headers,
    method: "POST",
  });
  assert.equal(start.status, 200);
  assert.deepEqual(await start.json(), {
    action: "https://github.com/settings/apps/new?state=manifest-state",
    manifest: { default_events: [], public: false },
    method: "POST",
    state: "manifest-state",
  });

  const manifest = await request(
    "/api/v1/github-connections/manifest/callback?code=temporary-code&state=manifest-state",
    { redirect: "manual" },
  );
  assert.equal(manifest.status, 303);
  assert.equal(
    manifest.headers.get("location"),
    "https://github.com/apps/quality-bar/installations/new",
  );
  const installation = await request(
    "/api/v1/github-connections/setup?installation_id=73&setup_action=install&state=manifest-state",
    { redirect: "manual" },
  );
  assert.equal(installation.status, 303);
  assert.equal(
    installation.headers.get("location"),
    "/?view=repositories&github_connection=connected",
  );
  assert.deepEqual(service.calls, [
    ["start"],
    ["manifest", { code: "temporary-code", state: "manifest-state" }],
    ["installation", { installationId: "73", state: "manifest-state" }],
  ]);

  const read = await request("/api/v1/github-connections", { headers });
  assert.equal(read.status, 200);
  assert.equal(await read.json(), null);
  const selection = await request("/api/v1/github-connections/repositories", {
    body: JSON.stringify({
      repository_ids: [101],
      request_id: selectionRequestId,
    }),
    headers,
    method: "POST",
  });
  assert.equal(selection.status, 201);
  assert.deepEqual(await selection.json(), [
    {
      api_url: "https://api.github.com/repos/operator/private",
      assignment_count: 0,
      credential_type: "forge_connection",
      deletion_eligible: true,
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
      verified_at: 1_000,
      web_url: "https://github.com/operator/private",
    },
  ]);
  assert.deepEqual(service.calls.at(-1), [
    "selection",
    { repository_ids: [101], request_id: selectionRequestId },
  ]);
  const unsupportedPat = await request("/api/v1/github-connections/pat", {
    body: "{}",
    headers,
    method: "POST",
  });
  assert.equal(unsupportedPat.status, 404);
  assert.equal(await responseErrorCode(unsupportedPat), "not_found");
});

test("GitHub callbacks return the exact owning error to the operator surface without inferred success", async () => {
  /** @type {{code: string, message: string} | null} */
  let callbackFailure = null;
  const { request } = await startApplication({
    createGitHubConnections: () => ({
      startPolling() {},
      read() {
        return null;
      },
      start() {
        return {};
      },
      async completeManifest() {
        throw new Error("not used");
      },
      async completeInstallation() {
        throw new GitHubConnectionError(
          "github_permissions_mismatch",
          "GitHub App permissions do not match the required profile",
        );
      },
      async rotate() {
        throw new Error("not used");
      },
      async selectRepositories() {
        throw new Error("not used");
      },
      /** @param {GitHubConnectionError} error */
      recordCallbackFailure(error) {
        callbackFailure = { code: error.code, message: error.message };
        return "error-receipt";
      },
      /** @param {string} receipt */
      consumeCallbackFailure(receipt) {
        if (receipt !== "error-receipt") {
          return null;
        }
        const failure = callbackFailure;
        callbackFailure = null;
        return failure;
      },
      destroy() {},
    }),
  });
  const invalid = await request(
    "/api/v1/github-connections/setup?installation_id=73&setup_action=wrong",
    { redirect: "manual" },
  );
  assert.equal(invalid.status, 303);
  assert.equal(
    invalid.headers.get("location"),
    "/?view=repositories&github_connection_error=error-receipt",
  );
  const headers = await authenticatedOperatorHeaders(request);
  const invalidFailure = await request(
    "/api/v1/github-connections/callback-error?receipt=error-receipt",
    { headers },
  );
  assert.deepEqual(await invalidFailure.json(), {
    code: "github_installation_callback_invalid",
    message: "GitHub App installation callback is invalid",
  });
  const response = await request(
    "/api/v1/github-connections/setup?installation_id=73&setup_action=install&state=manifest-state",
    { redirect: "manual" },
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "/?view=repositories&github_connection_error=error-receipt",
  );
  const failure = await request(
    "/api/v1/github-connections/callback-error?receipt=error-receipt",
    { headers },
  );
  assert.equal(failure.status, 200);
  assert.deepEqual(await failure.json(), {
    code: "github_permissions_mismatch",
    message: "GitHub App permissions do not match the required profile",
  });
  const replay = await request(
    "/api/v1/github-connections/callback-error?receipt=error-receipt",
    { headers },
  );
  assert.equal(replay.status, 200);
  assert.equal(await replay.json(), null);
});

test("transient GitHub Repository verification failures retain their exact owning error and unavailable status", async () => {
  for (const failure of [
    new GitHubConnectionError(
      "github_api_transient_failure",
      "GitHub API request temporarily failed with HTTP 503",
    ),
    new GitHubConnectionError(
      "github_git_verification_failed",
      "GitHub Repository Git verification could not complete",
    ),
  ]) {
    const { request } = await startApplication({
      createGitHubConnections: () => ({
        startPolling() {},
        read() {
          return null;
        },
        start() {
          return {};
        },
        async completeManifest() {
          throw new Error("not used");
        },
        async completeInstallation() {
          throw new Error("not used");
        },
        async rotate() {
          throw new Error("not used");
        },
        async selectRepositories() {
          throw failure;
        },
        recordCallbackFailure() {
          return "not-used";
        },
        consumeCallbackFailure() {
          return null;
        },
        destroy() {},
      }),
    });
    const headers = await authenticatedOperatorHeaders(request);
    const response = await request("/api/v1/github-connections/repositories", {
      body: JSON.stringify({
        repository_ids: [101],
        request_id: selectionRequestId,
      }),
      headers,
      method: "POST",
    });
    assert.equal(response.status, 503);
    assert.equal(await responseErrorCode(response), failure.code);
  }
});
