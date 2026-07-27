import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GITHUB_API_PROFILE,
  GITHUB_REQUIRED_PERMISSIONS,
  createGitHubAppManifest,
} from "../src/github-app-manifest.js";

test("GitHub App Manifest is private, webhook-free, and requests only the exact v1 permissions", () => {
  const manifest = createGitHubAppManifest({
    externalOrigin: "https://quality-bar.example",
    state: "manifest-state",
  });

  assert.deepEqual(manifest, {
    callback_urls: [],
    default_events: [],
    default_permissions: GITHUB_REQUIRED_PERMISSIONS,
    description: "Quality Bar personal GitHub Connection",
    hook_attributes: {
      active: false,
      url: "https://quality-bar.example/api/v1/github-connections/webhook-unsupported",
    },
    name: "Quality Bar",
    public: false,
    redirect_url:
      "https://quality-bar.example/api/v1/github-connections/manifest/callback",
    request_oauth_on_install: false,
    setup_on_update: false,
    setup_url:
      "https://quality-bar.example/api/v1/github-connections/setup?state=manifest-state",
    url: "https://quality-bar.example",
  });
  assert.equal(GITHUB_API_PROFILE, "github-rest:2026-03-10");
  assert.deepEqual(GITHUB_REQUIRED_PERMISSIONS, {
    contents: "read",
    issues: "write",
    metadata: "read",
    pull_requests: "write",
    statuses: "write",
  });
});

test("GitHub App Manifest rejects non-HTTPS origins and invalid state", () => {
  assert.throws(
    () =>
      createGitHubAppManifest({
        externalOrigin: "http://quality-bar.example",
        state: "manifest-state",
      }),
    /HTTPS external origin/,
  );
  assert.throws(
    () =>
      createGitHubAppManifest({
        externalOrigin: "https://quality-bar.example",
        state: "not a state",
      }),
    /manifest state/,
  );
});
