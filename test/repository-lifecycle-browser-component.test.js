import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {Record<string, unknown>} [properties] */
function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    options: /** @type {{textContent: string, value: string}[]} */ ([]),
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    /** @param {{textContent: string, value: string}} option */
    append(option) {
      this.options.push(option);
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`repository_listener_missing: ${name}`);
      }
      return listener;
    },
    querySelectorAll() {
      return [];
    },
    replaceChildren() {
      this.options = [];
    },
    reset() {},
  };
}

test("the Repository component displays lifecycle separately from health and surfaces failed enablement", async () => {
  const lifecycleForm = browserElement();
  const lifecycleRepository = browserElement();
  const lifecycleState = browserElement({ value: "enabled" });
  const lifecycleResult = browserElement();
  const inventory = browserElement();
  const error = browserElement({ hidden: true });
  const elements = new Map([
    [
      "browser-configuration",
      browserElement({
        textContent: JSON.stringify({
          csrfCookieName: "quality_bar_configured_csrf",
        }),
        type: "application/json",
      }),
    ],
    ["error", error],
    ["repository-inventory", inventory],
    ["repository-lifecycle-form", lifecycleForm],
    ["repository-lifecycle-repository", lifecycleRepository],
    ["repository-lifecycle-state", lifecycleState],
    ["repository-lifecycle-result", lifecycleResult],
    ["repository-lifecycle-submit", browserElement()],
    ["repository-create-form", browserElement()],
    ["repository-token", browserElement()],
    ["repository-url", browserElement()],
    ["repository-username", browserElement()],
    ["repository-create-result", browserElement()],
    ["repository-credential-rotate-form", browserElement()],
    ["repository-credential-rotate-repository", browserElement()],
    ["repository-credential-rotate-username", browserElement()],
    ["repository-credential-rotate-token", browserElement()],
    ["repository-credential-rotate-result", browserElement()],
    ["repository-credential-rotate-submit", browserElement()],
    ["password-change-form", browserElement()],
    ["session-revocation-form", browserElement()],
    ["implementer-token-create-form", browserElement()],
    ["implementer-token-rotate-form", browserElement()],
    ["implementer-token-revoke-form", browserElement()],
    ["implementer-token-reveal", browserElement()],
    ["implementer-token-reveal-close", browserElement()],
    ["implementer-token-value", browserElement()],
    ["logout", browserElement()],
  ]);
  let lifecycleAttempt = 0;
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
        return {
          ok: true,
          async json() {
            return {
              repositories: [
                {
                  credential_type: "none",
                  health: "healthy",
                  health_error: null,
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
        return {
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
        };
      }
      throw new Error(`unexpected request: ${path}`);
    },
    window: {},
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
    inventory.options.map(({ textContent }) => textContent),
    [
      "https://example.com/disabled.git — disabled — healthy",
      "https://example.com/error.git — enabled — error: Repository Git read verification failed",
    ],
  );
  assert.equal(lifecycleRepository.options.length, 2);

  lifecycleRepository.value = "repository-disabled";
  lifecycleState.value = "enabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
  assert.equal(lifecycleResult.textContent, "");

  lifecycleRepository.value = "repository-error";
  lifecycleState.value = "disabled";
  await lifecycleForm.listener("submit")({ preventDefault() {} });
  assert.equal(
    lifecycleResult.textContent,
    "https://example.com/error.git is disabled.",
  );
  assert.equal(
    inventory.options[1].textContent,
    "https://example.com/error.git — disabled — error: Repository Git read verification failed",
  );
});
