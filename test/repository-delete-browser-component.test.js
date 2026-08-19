import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  browserElement,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("Repository deletion focuses the owning listing error when refresh fails", async () => {
  assert.match(
    operatorPage({ view: "repositories" }),
    /<p hidden id="error" role="alert" tabindex="-1"><\/p>/,
  );
  const error = browserElement({ hidden: true });
  const lifecycleResult = browserElement();
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-lifecycle-result", lifecycleResult],
  ]);
  const browserContext = {
    async fetch() {
      return { ok: true };
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        async displayMutationFailure() {},
        error,
        /** @param {string} id */
        requiredElement: (id) => elements.get(id),
      },
      qualityBarRepositories: {
        confirmationIdentity: () => "https://example.com/unused.git",
        find: () => ({
          deletion_eligible: true,
          id: "repository-1",
          url: "https://example.com/unused.git",
        }),
        ready: async () => true,
        async refresh() {
          error.textContent = "Repository listing failed";
          error.hidden = false;
          return false;
        },
        syncDeleteAvailability() {},
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-delete.js",
    readBrowserAsset("/assets/repository-delete.js"),
    browserContext,
  );
  const repositorySelect = /** @type {any} */ (
    elements.get("repository-lifecycle-repository")
  );
  const deleteButton = /** @type {any} */ (elements.get("repository-delete"));
  const confirmationInput = /** @type {any} */ (
    elements.get("repository-delete-confirmation-input")
  );
  const confirmationForm = /** @type {any} */ (
    elements.get("repository-delete-confirmation-form")
  );
  repositorySelect.value = "repository-1";
  await deleteButton.listener("click")({});
  confirmationInput.value = "https://example.com/unused.git";
  await confirmationForm.listener("submit")({ preventDefault() {} });

  assert.equal(error.textContent, "Repository listing failed");
  assert.equal(error.focused, true);
  assert.equal(lifecycleResult.focused, false);
});

test("Repository deletion refreshes canonical state without inferring lost-response success", async () => {
  const error = browserElement({ hidden: true });
  const lifecycleResult = browserElement();
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-lifecycle-result", lifecycleResult],
  ]);
  let deleted = false;
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-delete.js",
    readBrowserAsset("/assets/repository-delete.js"),
    {
      async fetch() {
        deleted = true;
        throw new TypeError("response lost");
      },
      window: {
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          async displayMutationFailure() {},
          error,
          /** @param {string} id */
          requiredElement: (id) => elements.get(id),
        },
        qualityBarRepositories: {
          confirmationIdentity: () => "https://example.com/unused.git",
          find: () =>
            deleted
              ? undefined
              : {
                  deletion_eligible: true,
                  id: "repository-1",
                  url: "https://example.com/unused.git",
                },
          ready: async () => true,
          refresh: async () => true,
          syncDeleteAvailability() {},
        },
      },
    },
  );
  const repositorySelect = /** @type {any} */ (
    elements.get("repository-lifecycle-repository")
  );
  const confirmationInput = /** @type {any} */ (
    elements.get("repository-delete-confirmation-input")
  );
  repositorySelect.value = "repository-1";
  await elements.get("repository-delete")?.listener("click")({});
  confirmationInput.value = "https://example.com/unused.git";
  await elements.get("repository-delete-confirmation-form")?.listener("submit")(
    { preventDefault() {} },
  );

  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Repository deletion failed");
  assert.equal(error.focused, true);
  assert.equal(lifecycleResult.textContent, "");
  assert.equal(lifecycleResult.focused, false);
});

test("Repository deletion refreshes conflict-driven canonical state", async () => {
  const error = browserElement({ hidden: true });
  const elements = repositoryBrowserElements([["error", error]]);
  let deletionEligible = true;
  let refreshed = false;
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-delete.js",
    readBrowserAsset("/assets/repository-delete.js"),
    {
      async fetch() {
        return { ok: false };
      },
      window: {
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          async displayMutationFailure() {
            error.textContent = "Repository changed during deletion";
            error.hidden = false;
          },
          error,
          /** @param {string} id */
          requiredElement: (id) => elements.get(id),
        },
        qualityBarRepositories: {
          confirmationIdentity: () => "https://example.com/unused.git",
          find: () => ({
            deletion_eligible: deletionEligible,
            id: "repository-1",
            url: "https://example.com/unused.git",
          }),
          ready: async () => true,
          async refresh() {
            deletionEligible = false;
            refreshed = true;
            return true;
          },
          syncDeleteAvailability() {},
        },
      },
    },
  );
  const repositorySelect = /** @type {any} */ (
    elements.get("repository-lifecycle-repository")
  );
  const confirmationInput = /** @type {any} */ (
    elements.get("repository-delete-confirmation-input")
  );
  repositorySelect.value = "repository-1";
  await elements.get("repository-delete")?.listener("click")({});
  confirmationInput.value = "https://example.com/unused.git";
  await elements.get("repository-delete-confirmation-form")?.listener("submit")(
    { preventDefault() {} },
  );

  assert.equal(refreshed, true);
  assert.equal(deletionEligible, false);
  assert.equal(error.textContent, "Repository changed during deletion");
  assert.equal(error.focused, true);
});
