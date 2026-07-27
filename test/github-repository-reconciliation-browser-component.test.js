import assert from "node:assert/strict";
import { test } from "node:test";

import {
  browserContext,
  executeGitHubBrowserAsset,
  verifiedConnection,
} from "./github-connection-browser-component-support.js";

test("lost selection response reconciles server state without exposing stale choices", async () => {
  let connectionReads = 0;
  const browser = browserContext(async (path) => {
    if (path === "/api/v1/github-connections/repositories") {
      throw new Error("response lost after request");
    }
    connectionReads += 1;
    const connection = verifiedConnection();
    if (connectionReads === 1) {
      return { json: async () => connection, ok: true };
    }
    return {
      json: async () => ({
        ...connection,
        health: "error",
        health_error: {
          code: "github_permissions_mismatch",
          message: "GitHub App permissions do not match",
        },
        verification_history: [
          ...connection.verification_history,
          {
            affected_repository_ids: [101],
            api_profile: null,
            capabilities: null,
            error: {
              code: "github_permissions_mismatch",
              message: "GitHub App permissions do not match",
              repository_id: null,
            },
            id: "verification-2",
            outcome: "error",
            permissions: null,
            principal: null,
            repositories: [],
            repository_checks: [
              { outcome: "not_completed", repository_id: 101 },
            ],
            trigger: "repository_selection",
            verified_at: 2_000,
          },
        ],
        verified_at: 2_000,
      }),
      ok: true,
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(browser.repositoryRefreshes(), 1);
  assert.equal(browser.github.repositoryForm.hidden, false);
  assert.equal(browser.github.repositoryOptions.children.length, 1);
  assert.equal(
    browser.github.repositoryOptions.children[0].children[1].textContent,
    "Forge Repository 101; verification required",
  );
  assert.equal(
    browser.error.textContent,
    "GitHub Repository selection result is unavailable",
  );
  assert.equal(browser.github.repositorySubmit.disabled, false);
});

test("lost selection response reports confirmed server registration", async () => {
  let connectionReads = 0;
  const browser = browserContext(
    async (path) => {
      if (path === "/api/v1/github-connections/repositories") {
        throw new Error("response lost after commit");
      }
      connectionReads += 1;
      const connection = verifiedConnection();
      if (connectionReads === 1) {
        return { json: async () => connection, ok: true };
      }
      return {
        json: async () => ({
          ...connection,
          verification_history: [
            ...connection.verification_history,
            {
              ...connection.verification_history[0],
              id: "verification-2",
              trigger: "repository_selection",
              verified_at: 2_000,
            },
          ],
          verified_at: 2_000,
        }),
        ok: true,
      };
    },
    [101],
  );
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(browser.context.location.assigned, "/?view=repositories");
  assert.equal(browser.status.textContent, "GitHub Repositories registered.");
  assert.equal(browser.error.hidden, true);
});

test("pre-existing registration does not infer a lost selection succeeded", async () => {
  const browser = browserContext(
    async (path) => {
      if (path === "/api/v1/github-connections/repositories") {
        throw new Error("request did not complete");
      }
      return { json: async () => verifiedConnection(), ok: true };
    },
    [101],
  );
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(browser.context.location.assigned, "");
  assert.equal(
    browser.error.textContent,
    "GitHub Repository selection result is unavailable",
  );
});

test("failed selection reconciliation disables stale controls", async () => {
  let reads = 0;
  const browser = browserContext(
    async (path) => {
      if (path === "/api/v1/github-connections/repositories") {
        throw new Error("response lost");
      }
      reads += 1;
      if (reads > 1) {
        throw new Error("reconciliation unavailable");
      }
      return { json: async () => verifiedConnection(), ok: true };
    },
    [],
    false,
  );
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(browser.github.repositoryForm.hidden, true);
  assert.equal(browser.github.repositorySubmit.disabled, true);
  assert.equal(
    browser.error.textContent,
    "GitHub Repository selection reconciliation failed",
  );
});

test("failed selection refresh clears controls when the Connection is absent", async () => {
  let connectionReads = 0;
  const browser = browserContext(async (path) => {
    if (path === "/api/v1/github-connections/repositories") {
      return {
        json: async () => ({
          error: {
            message: "Selected GitHub Repository is not accessible",
          },
        }),
        ok: false,
      };
    }
    connectionReads += 1;
    return {
      json: async () => (connectionReads === 1 ? verifiedConnection() : null),
      ok: true,
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(browser.github.repositoryForm.hidden, true);
  assert.equal(browser.github.repositoryOptions.children.length, 0);
  assert.equal(browser.github.repositorySubmit.disabled, true);
  assert.equal(
    browser.error.textContent,
    "Selected GitHub Repository is not accessible",
  );
});
