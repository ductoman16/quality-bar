import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import {
  GITHUB_API_PROFILE,
  GITHUB_MANDATED_EVENTS,
  GITHUB_REQUIRED_PERMISSIONS,
  createGitHubAppManifest,
} from "../src/github/github-app-manifest.ts";
import { createGitHubVerifier } from "../src/github/github-api.ts";
import { GitHubConnectionError } from "../src/github/github-connection-error.ts";

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

test("GitHub verifier rejects configured events beyond GitHub-mandated events", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let appEvents = GITHUB_MANDATED_EVENTS;
  let installationEvents = GITHUB_MANDATED_EVENTS;
  const verifier = createGitHubVerifier({
    fetch: async (url: any) => {
      const path = new URL(url).pathname;
      if (path === "/app") {
        return Response.json({
          events: appEvents,
          id: 47,
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          permissions: GITHUB_REQUIRED_PERMISSIONS,
          public: false,
          slug: "quality-bar-personal",
        });
      }
      if (path === "/app/installations") {
        return Response.json([
          {
            account: { id: 91, login: "operator", type: "User" },
            app_id: 47,
            events: installationEvents,
            id: 73,
            permissions: GITHUB_REQUIRED_PERMISSIONS,
            repository_selection: "selected",
            suspended_at: null,
            target_type: "User",
          },
        ]);
      }
      if (path === "/app/installations/73/access_tokens") {
        return Response.json({
          permissions: GITHUB_REQUIRED_PERMISSIONS,
          token: "installation-token",
        });
      }
      if (path === "/installation/repositories") {
        return Response.json({ repositories: [], total_count: 0 });
      }
      throw new Error(`unexpected fixture path: ${path}`);
    },
    now: () => 2_000_000_000_000,
  });
  const credential = {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" as const },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };

  appEvents = [...GITHUB_MANDATED_EVENTS, "push"];
  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_app_profile_mismatch",
  );

  appEvents = GITHUB_MANDATED_EVENTS;
  installationEvents = [...GITHUB_MANDATED_EVENTS, "push"];
  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_installation_mismatch",
  );

  installationEvents = GITHUB_MANDATED_EVENTS;
  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enumeration_incomplete",
  );
});

test("GitHub verifier accepts omitted or private visibility but rejects public Apps", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let appVisibility: boolean | undefined;
  const verifier = createGitHubVerifier({
    fetch: async (url: any) => {
      const path = new URL(url).pathname;
      if (path === "/app") {
        const app: Record<string, unknown> = {
          events: GITHUB_MANDATED_EVENTS,
          id: 47,
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          permissions: GITHUB_REQUIRED_PERMISSIONS,
          slug: "quality-bar-personal",
        };
        if (appVisibility !== undefined) {
          app.public = appVisibility;
        }
        return Response.json(app);
      }
      if (path === "/app/installations") {
        return Response.json([
          {
            account: { id: 91, login: "operator", type: "User" },
            app_id: 47,
            events: GITHUB_MANDATED_EVENTS,
            id: 73,
            permissions: GITHUB_REQUIRED_PERMISSIONS,
            repository_selection: "selected",
            suspended_at: null,
            target_type: "User",
          },
        ]);
      }
      if (path === "/app/installations/73/access_tokens") {
        return Response.json({
          permissions: GITHUB_REQUIRED_PERMISSIONS,
          token: "installation-token",
        });
      }
      if (path === "/installation/repositories") {
        return Response.json({ repositories: [], total_count: 0 });
      }
      throw new Error(`unexpected fixture path: ${path}`);
    },
    now: () => 2_000_000_000_000,
  });
  const credential = {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" as const },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };

  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enumeration_incomplete",
  );

  appVisibility = false;
  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enumeration_incomplete",
  );

  appVisibility = true;
  await assert.rejects(
    () => verifier.verifyInstallation(credential, 73),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_app_profile_mismatch",
  );
});
