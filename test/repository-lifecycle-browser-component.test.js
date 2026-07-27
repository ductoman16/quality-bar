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

test("the Repository component displays lifecycle separately from health and surfaces failed enablement", async () => {
  const lifecycleForm = browserElement();
  const lifecycleRepository = browserElement();
  const lifecycleState = browserElement({ value: "enabled" });
  const lifecycleResult = browserElement();
  const lifecycleSubmit = browserElement();
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
  ]);
  let lifecycleAttempt = 0;
  let listAttempt = 0;
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
        if (listAttempt === 3) {
          throw new Error("Repository listing unavailable");
        }
        return {
          ok: true,
          async json() {
            return {
              repositories: [
                {
                  credential_type: "none",
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
                  health: "error",
                  health_error: {
                    code: "repository_git_read_failed",
                    message: "Repository Git read verification failed",
                  },
                  id: "repository-error",
                  lifecycle: "enabled",
                  url: "https://example.com/error.git",
                },
              ],
            };
          },
        };
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
          throw new Error("response lost after lifecycle request");
        }
        return lifecycleRequest.promise;
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
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    inventory.options.map((row) =>
      row.options.map(
        (/** @type {{textContent: string}} */ cell) => cell.textContent,
      ),
    ),
    [
      ["https://example.com/disabled.git", "disabled", "healthy"],
      [
        "https://example.com/error.git",
        "enabled",
        "error: Repository Git read verification failed",
      ],
    ],
  );
  assert.equal(lifecycleRepository.options.length, 2);

  lifecycleRepository.value = "repository-disabled";
  lifecycleState.value = "enabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
  assert.equal(lifecycleResult.textContent, "");
  assert.deepEqual(
    inventory.options[0].options.map(
      (/** @type {{textContent: string}} */ cell) => cell.textContent,
    ),
    [
      "https://example.com/disabled.git",
      "disabled",
      "error: Repository Git read verification failed",
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
    inventory.options[1].options.map(
      (/** @type {{textContent: string}} */ cell) => cell.textContent,
    ),
    [
      "https://example.com/error.git",
      "disabled",
      "error: Repository Git read verification failed",
    ],
  );

  lifecycleRepository.value = "repository-disabled";
  lifecycleState.value = "enabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository listing failed");
  assert.equal(error.hidden, false);
  assert.equal(lifecycleResult.textContent, "");
  assert.equal(listAttempt, 3);
  assert.equal(inventory.options.length, 0);
  assert.equal(lifecycleRepository.options.length, 0);
  assert.equal(lifecycleSubmit.disabled, true);
});
