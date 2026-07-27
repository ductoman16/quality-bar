import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";
import {
  browserContext,
  executeGitHubBrowserAsset,
  verifiedConnection,
} from "./github-connection-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Repository inventory keeps GitHub identity, metadata, lifecycle, health, dependent access, and verification visible", async () => {
  const inventory = browserElement();
  const error = browserElement({ hidden: true });
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-inventory", inventory],
  ]);
  const browserContext = {
    Date,
    document: { createElement: () => browserElement() },
    fetch: async () => {
      throw new Error("unexpected request");
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        async displayMutationFailure() {},
        error,
        async readRepositoryCollection() {
          return {
            failure: null,
            items: [
              {
                api_url: "https://api.github.com/repos/operator/private",
                assignment_count: 2,
                credential_type: "forge_connection",
                forge_connection_id: "connection-1",
                forge_repository_id: 101,
                health: "healthy",
                health_error: null,
                id: "repository-1",
                lifecycle: "disabled",
                name: "operator/private-renamed",
                provider: "github",
                url: "https://github.com/operator/private-renamed.git",
                verified_at: 1_000,
                web_url: "https://github.com/operator/private-renamed",
              },
            ],
          };
        },
        /** @param {string} id */
        requiredElement: (id) => elements.get(id),
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository.js",
    readBrowserAsset("/assets/repository.js"),
    browserContext,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const cells = /** @type {any[]} */ (inventory.options[0].options);
  assert.deepEqual(
    cells.map(({ "data-label": label, textContent }) => ({
      label,
      textContent,
    })),
    [
      {
        label: "Provider and Connection",
        textContent: "GitHub; connection-1",
      },
      {
        label: "Identity",
        textContent:
          "operator/private-renamed; Forge Repository 101; https://github.com/operator/private-renamed.git; https://github.com/operator/private-renamed; https://api.github.com/repos/operator/private",
      },
      { label: "Lifecycle", textContent: "disabled" },
      { label: "Health", textContent: "healthy" },
      { label: "Assignments", textContent: "2" },
      {
        label: "Latest verification",
        textContent: "1970-01-01T00:00:01.000Z",
      },
    ],
  );
});

test("GitHub Repository selection rejects a duplicate success response without inferred registration", async () => {
  const connection = verifiedConnection();
  connection.verification_history[0].repositories.push({
    api_url: "https://api.github.com/repos/operator/public",
    clone_url: "https://github.com/operator/public.git",
    full_name: "operator/public",
    html_url: "https://github.com/operator/public",
    id: 202,
    private: false,
  });
  const browser = browserContext(async (path) => ({
    ok: true,
    async json() {
      return path === "/api/v1/github-connections"
        ? connection
        : [{ forge_repository_id: 101 }, { forge_repository_id: 101 }];
    },
  }));
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  for (const label of browser.github.repositoryOptions.children) {
    label.children[0].checked = true;
  }

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(
    browser.error.textContent,
    "GitHub Repository selection result is unavailable",
  );
  assert.equal(browser.error.focused, true);
  assert.equal(browser.status.textContent, "");
  assert.equal(browser.context.location.assigned, "");
});

test("GitHub Connection health exposes the exact owning verification error", async () => {
  const connection = {
    ...verifiedConnection(),
    health: "error",
    health_error: {
      code: "github_permissions_mismatch",
      message: "GitHub App permissions do not match the required profile",
    },
  };
  const browser = browserContext(async () => ({
    ok: true,
    async json() {
      return connection;
    },
  }));

  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    browser.github.health.textContent,
    "GitHub App permissions do not match the required profile (github_permissions_mismatch)",
  );
  assert.equal(
    browser.status.textContent,
    "GitHub Connection verification failed.",
  );
});

test("failed selection reloads server-owned GitHub Connection health without hiding the exact error", async () => {
  let request = 0;
  const browser = browserContext(async () => {
    request += 1;
    if (request === 1) {
      return {
        ok: true,
        async json() {
          return verifiedConnection();
        },
      };
    }
    if (request === 2) {
      return {
        ok: false,
        async json() {
          return {
            error: {
              message:
                "GitHub App permissions do not match the required profile",
            },
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          ...verifiedConnection(),
          health: "error",
          health_error: {
            code: "github_permissions_mismatch",
            message: "GitHub App permissions do not match the required profile",
          },
        };
      },
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  browser.github.repositoryOptions.children[0].children[0].checked = true;

  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });

  assert.equal(request, 3);
  assert.equal(browser.repositoryRefreshes(), 1);
  assert.equal(
    browser.error.textContent,
    "GitHub App permissions do not match the required profile",
  );
  assert.equal(browser.error.focused, true);
  assert.equal(
    browser.github.health.textContent,
    "GitHub App permissions do not match the required profile (github_permissions_mismatch)",
  );
});
