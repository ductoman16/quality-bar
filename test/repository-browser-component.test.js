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
    resetCalled: false,
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
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
    reset() {
      this.resetCalled = true;
    },
  };
}

test("the Repository component registers one public HTTPS URL and surfaces the exact owning error", async () => {
  const form = browserElement();
  const url = browserElement({
    value: "https://EXAMPLE.com:443/team/repository.git/",
  });
  const result = browserElement();
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
    ["repository-create-form", form],
    ["repository-url", url],
    ["repository-create-result", result],
  ]);
  /** @type {{path: string, options: object}[]} */
  const requests = [];
  let attempt = 0;

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-create.js",
    readBrowserAsset("/assets/repository-create.js"),
    {
      document: {
        cookie: "quality_bar_configured_csrf=csrf-token",
        /** @param {string} id */
        getElementById(id) {
          return elements.get(id) ?? null;
        },
      },
      /** @param {string} path @param {object} options */
      async fetch(path, options) {
        requests.push({ options, path });
        attempt += 1;
        if (attempt === 1) {
          return {
            ok: true,
            async json() {
              return {
                id: "repository-1",
                url: "https://example.com/team/repository.git",
              };
            },
          };
        }
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
      },
    },
  );

  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {
    options: {
      body: JSON.stringify({
        url: "https://EXAMPLE.com:443/team/repository.git/",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/repositories",
  });
  assert.equal(
    result.textContent,
    "https://example.com/team/repository.git registered.",
  );
  assert.equal(form.resetCalled, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
});
