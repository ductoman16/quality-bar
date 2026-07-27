import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

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
