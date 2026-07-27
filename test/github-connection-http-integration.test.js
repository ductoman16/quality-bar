import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

function connectionService() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    create() {
      return {
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
        destroy() {},
      };
    },
  };
}

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
  const unsupportedPat = await request("/api/v1/github-connections/pat", {
    body: "{}",
    headers,
    method: "POST",
  });
  assert.equal(unsupportedPat.status, 404);
  assert.equal(await responseErrorCode(unsupportedPat), "not_found");
});

test("GitHub callbacks return the exact owning error to the operator surface without inferred success", async () => {
  const { request } = await startApplication({
    createGitHubConnections: () => ({
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
      destroy() {},
    }),
  });
  const response = await request(
    "/api/v1/github-connections/setup?installation_id=73&setup_action=install&state=manifest-state",
    { redirect: "manual" },
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "/?view=repositories&github_connection_error=GitHub%20App%20permissions%20do%20not%20match%20the%20required%20profile",
  );
});
