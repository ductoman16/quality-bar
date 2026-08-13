import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  findByText,
  labeledCells,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Repository component displays lifecycle separately from health and surfaces failed enablement", async () => {
  const lifecycleForm = browserElement();
  const lifecycleRepository = browserElement();
  const lifecycleState = browserElement({ value: "enabled" });
  const lifecycleResult = browserElement();
  const lifecycleSubmit = browserElement();
  const repositoryDelete = browserElement();
  const repositoryDeleteConfirmation = browserElement();
  const repositoryDeleteConfirmationForm = browserElement();
  const repositoryDeleteConfirmationInput = browserElement();
  const repositoryDeleteConfirmationMessage = browserElement();
  const inventory = browserElement();
  const error = browserElement({ hidden: true });
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-inventory", inventory],
    ["repository-lifecycle-form", lifecycleForm],
    ["repository-lifecycle-repository", lifecycleRepository],
    ["repository-lifecycle-state", lifecycleState],
    ["repository-lifecycle-result", lifecycleResult],
    ["repository-lifecycle-submit", lifecycleSubmit],
    ["repository-delete", repositoryDelete],
    ["repository-delete-confirmation", repositoryDeleteConfirmation],
    ["repository-delete-confirmation-form", repositoryDeleteConfirmationForm],
    ["repository-delete-confirmation-input", repositoryDeleteConfirmationInput],
    [
      "repository-delete-confirmation-message",
      repositoryDeleteConfirmationMessage,
    ],
  ]);
  const credentialRepository = elements.get(
    "repository-credential-rotate-repository",
  );
  const credentialSubmit = elements.get("repository-credential-rotate-submit");
  let lifecycleAttempt = 0;
  let listAttempt = 0;
  let deletedRepository = false;
  const lifecycleRequest = Promise.withResolvers();
  /** @type {string[]} */
  const confirmations = [];
  const browserContext = {
    Date,
    document: {
      cookie: "quality_bar_configured_csrf=csrf-token",
      addEventListener() {},
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    /** @param {string} path @param {object} [options] */
    async fetch(path, options) {
      if (path === "/api/v1/system") {
        return {
          ok: true,
          async json() {
            return {
              bootstrap: { status: "ready" },
              browser_sessions: { active_count: 1 },
              codex: { catalog: { models: [] }, status: "available" },
              durable_core: { status: "ready" },
              implementer_token: { status: "revoked" },
            };
          },
        };
      }
      if (path === "/api/v1/repositories" && !options) {
        listAttempt += 1;
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  credential_type: "none",
                  deletion_eligible: false,
                  health: listAttempt === 1 ? "healthy" : "error",
                  health_error:
                    listAttempt === 1
                      ? null
                      : {
                          code: "repository_git_read_failed",
                          message: "Repository Git read verification failed",
                        },
                  id: "repository-disabled",
                  lifecycle: "disabled",
                  url: "https://example.com/disabled.git",
                },
                {
                  credential_type: "username_token",
                  deletion_eligible: false,
                  health: "error",
                  health_error: {
                    code: "repository_git_read_failed",
                    message: "Repository Git read verification failed",
                  },
                  id: "repository-error",
                  lifecycle: "enabled",
                  url: "https://example.com/error.git",
                },
                {
                  credential_type: "none",
                  deletion_eligible: true,
                  health: "healthy",
                  health_error: null,
                  id: "repository-unused",
                  lifecycle: "enabled",
                  url: "https://example.com/unused.git",
                },
              ].filter(
                (repository) =>
                  !deletedRepository || repository.id !== "repository-unused",
              ),
              next_cursor: listAttempt === 4 ? "failing-page" : null,
            };
          },
        };
      }
      if (path === "/api/v1/repositories?cursor=failing-page" && !options) {
        throw new Error("Repository listing unavailable");
      }
      if (path.endsWith("/lifecycle")) {
        lifecycleAttempt += 1;
        if (lifecycleAttempt === 1) {
          return {
            ok: false,
            async json() {
              return {
                error: {
                  code: "repository_git_read_failed",
                  message: "Repository Git read verification failed",
                },
              };
            },
          };
        }
        if (lifecycleAttempt === 3) {
          return {
            ok: true,
            async json() {
              return {
                credential_type: "none",
                deletion_eligible: false,
                health: "error",
                health_error: {
                  code: "repository_git_read_failed",
                  message: "Repository Git read verification failed",
                },
                id: "repository-error",
                lifecycle: "retired",
                url: "https://example.com/error.git",
              };
            },
          };
        }
        if (lifecycleAttempt === 4) {
          throw new Error("response lost after lifecycle request");
        }
        return lifecycleRequest.promise;
      }
      if (
        path === "/api/v1/repositories/repository-unused" &&
        /** @type {{method?: string} | undefined} */ (options)?.method ===
          "DELETE"
      ) {
        deletedRepository = true;
        return {
          ok: true,
          async json() {
            return null;
          },
        };
      }
      throw new Error(`unexpected request: ${path}`);
    },
    window: {
      /** @param {string} message */
      confirm(message) {
        confirmations.push(message);
        return true;
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    readBrowserAsset("/assets/operator.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository.js",
    readBrowserAsset("/assets/repository.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-delete.js",
    readBrowserAsset("/assets/repository-delete.js"),
    browserContext,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    inventory.options.map((row) =>
      labeledCells(row).map(
        (/** @type {{textContent: string}} */ cell) => cell.textContent,
      ),
    ),
    [
      [
        "Generic HTTPS Git",
        "https://example.com/disabled.git",
        "disabled",
        "healthy",
        "—",
        "—",
      ],
      [
        "Generic HTTPS Git",
        "https://example.com/error.git",
        "enabled",
        "error: Repository Git read verification failed",
        "—",
        "—",
      ],
      [
        "Generic HTTPS Git",
        "https://example.com/unused.git",
        "enabled",
        "healthy",
        "—",
        "—",
      ],
    ],
  );
  assert.equal(lifecycleRepository.options.length, 3);

  lifecycleRepository.value = "repository-disabled";
  lifecycleState.value = "enabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
  assert.equal(lifecycleResult.textContent, "");
  assert.deepEqual(
    labeledCells(inventory.options[0]).map(
      (/** @type {{textContent: string}} */ cell) => cell.textContent,
    ),
    [
      "Generic HTTPS Git",
      "https://example.com/disabled.git",
      "disabled",
      "error: Repository Git read verification failed",
      "—",
      "—",
    ],
  );

  lifecycleRepository.value = "repository-error";
  lifecycleState.value = "disabled";
  const pendingLifecycle = lifecycleForm.listener("submit")({
    preventDefault() {},
  });
  await Promise.resolve();
  assert.equal(lifecycleSubmit.disabled, true);
  assert.equal(lifecycleResult.textContent, "Applying lifecycle.");
  lifecycleRequest.resolve({
    ok: true,
    async json() {
      return {
        credential_type: "username_token",
        deletion_eligible: false,
        health: "error",
        health_error: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        id: "repository-error",
        lifecycle: "disabled",
        url: "https://example.com/error.git",
      };
    },
  });
  await pendingLifecycle;
  assert.equal(lifecycleSubmit.disabled, false);
  assert.equal(
    lifecycleResult.textContent,
    "https://example.com/error.git is disabled.",
  );
  assert.equal(
    confirmations.at(-1),
    "Disable https://example.com/error.git? New work will be rejected; already-created work may finish.",
  );
  assert.deepEqual(
    labeledCells(inventory.options[1]).map(
      (/** @type {{textContent: string}} */ cell) => cell.textContent,
    ),
    [
      "Generic HTTPS Git",
      "https://example.com/error.git",
      "disabled",
      "error: Repository Git read verification failed",
      "—",
      "—",
    ],
  );

  lifecycleRepository.value = "repository-error";
  lifecycleState.value = "retired";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(
    confirmations.at(-1),
    "Retire https://example.com/error.git? Repository-bound credentials will be destroyed.",
  );
  assert.equal(
    lifecycleResult.textContent,
    "https://example.com/error.git is retired.",
  );
  assert.equal(credentialRepository?.options.length, 0);
  assert.equal(credentialRepository?.disabled, true);
  assert.equal(credentialSubmit?.disabled, true);
  assert.equal(repositoryDelete.disabled, true);

  lifecycleRepository.value = "repository-error";
  await repositoryDelete.listener("click")({});
  assert.equal(repositoryDeleteConfirmation.open, false);

  lifecycleRepository.value = "repository-unused";
  await lifecycleRepository.listener("change")({});
  assert.equal(repositoryDelete.disabled, false);
  await repositoryDelete.listener("click")({});
  assert.equal(
    repositoryDeleteConfirmationMessage.textContent,
    "Delete https://example.com/unused.git permanently. This cannot be undone.",
  );
  assert.equal(repositoryDeleteConfirmation.open, true);
  repositoryDeleteConfirmationInput.value = "unused";
  await repositoryDeleteConfirmationForm.listener("submit")({
    preventDefault() {},
  });
  assert.equal(
    error.textContent,
    "Type the Repository identity to confirm permanent deletion",
  );
  assert.equal(deletedRepository, false);
  repositoryDeleteConfirmationInput.value = "https://example.com/unused.git";
  await repositoryDeleteConfirmationForm.listener("submit")({
    preventDefault() {},
  });
  assert.equal(repositoryDeleteConfirmation.open, false);
  assert.equal(
    lifecycleResult.textContent,
    "https://example.com/unused.git deleted.",
  );
  assert.equal(lifecycleResult.focused, true);
  assert.equal(inventory.options.length, 2);

  lifecycleRepository.value = "repository-disabled";
  lifecycleState.value = "enabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository listing failed");
  assert.equal(error.hidden, false);
  assert.equal(lifecycleResult.textContent, "");
  assert.equal(listAttempt, 4);
  assert.equal(inventory.options.length, 0);
  assert.equal(lifecycleRepository.options.length, 0);
  assert.equal(lifecycleSubmit.disabled, true);
});

test("inventory row actions drive lifecycle, credential rotation, and deletion", async () => {
  const inventory = browserElement();
  const error = browserElement({ hidden: true });
  const lifecycleRepository = browserElement();
  const lifecycleState = browserElement({ value: "enabled" });
  const repositoryDelete = browserElement();
  const repositoryDeleteConfirmation = browserElement();
  const repositoryDeleteConfirmationMessage = browserElement();
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-inventory", inventory],
    ["repository-lifecycle-repository", lifecycleRepository],
    ["repository-lifecycle-state", lifecycleState],
    ["repository-delete", repositoryDelete],
    ["repository-delete-confirmation", repositoryDeleteConfirmation],
    [
      "repository-delete-confirmation-message",
      repositoryDeleteConfirmationMessage,
    ],
  ]);
  /** @type {string[]} */
  const confirmations = [];
  /** @type {{path: string, options: any}[]} */
  const requests = [];
  const repository = {
    credential_type: "username_token",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository-row",
    lifecycle: "enabled",
    url: "https://example.com/row.git",
  };
  const browserContext = {
    Date,
    document: {
      cookie: "quality_bar_configured_csrf=csrf-token",
      addEventListener() {},
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    /** @param {string} path @param {any} [options] */
    async fetch(path, options) {
      requests.push({ options, path });
      if (path === "/api/v1/repositories" && !options) {
        return {
          ok: true,
          async json() {
            return { items: [{ ...repository }], next_cursor: null };
          },
        };
      }
      if (path.endsWith("/lifecycle")) {
        return {
          ok: true,
          async json() {
            return { ...repository, lifecycle: "disabled" };
          },
        };
      }
      if (path.endsWith("/credential/rotate")) {
        return {
          ok: true,
          async json() {
            return { ...repository, lifecycle: "disabled" };
          },
        };
      }
      throw new Error(`unexpected request: ${path}`);
    },
    window: {
      /** @param {string} message */
      confirm(message) {
        confirmations.push(message);
        return true;
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    readBrowserAsset("/assets/operator.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository.js",
    readBrowserAsset("/assets/repository.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-delete.js",
    readBrowserAsset("/assets/repository-delete.js"),
    browserContext,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const row = inventory.options[0];
  // Expand the row (the summary's toggle button) to reveal its inline actions.
  const toggle = row.options[0].options[0];
  toggle.listener("click")({});
  assert.equal(row.options[0].options[0]["aria-expanded"], "true");

  // Disable via the row action drives the (hidden) lifecycle form.
  findByText(row, "Disable").listener("click")({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    confirmations.at(-1),
    "Disable https://example.com/row.git? New work will be rejected; already-created work may finish.",
  );
  assert.ok(requests.some(({ path }) => path.endsWith("/lifecycle")));

  // Rotate credential via the row action reveals inputs and drives the form.
  const rotate = findByText(inventory.options[0], "Rotate credential");
  rotate.listener("click")({});
  findByText(inventory.options[0], "Save credential").listener("click")({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(requests.some(({ path }) => path.endsWith("/credential/rotate")));

  // Delete via the row action opens the confirmation dialog.
  findByText(inventory.options[0], "Delete").listener("click")({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycleRepository.value, "repository-row");
  assert.equal(repositoryDeleteConfirmation.open, true);
  assert.equal(
    repositoryDeleteConfirmationMessage.textContent,
    "Delete https://example.com/row.git permanently. This cannot be undone.",
  );
});
