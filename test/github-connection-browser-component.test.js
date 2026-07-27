import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {Record<string, any>} [properties] */
function element(properties = {}) {
  /** @type {Map<string, (event: any) => any>} */
  const listeners = new Map();
  return {
    disabled: false,
    focused: false,
    hidden: false,
    textContent: "",
    ...properties,
    /** @param {string} name @param {(event: any) => any} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    focus() {
      this.focused = true;
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`listener_missing:${name}`);
      }
      return listener;
    },
  };
}

/** @param {(path: string, options?: any) => Promise<any>} fetch */
function browserContext(fetch) {
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const elements = new Map([
    ["github-connection-form", form],
    ["github-connection-submit", submit],
    ["github-connection-status", status],
    ["github-connection-error", error],
  ]);
  return {
    context: {
      URLSearchParams,
      document: { body: { append() {} }, createElement: () => ({}) },
      fetch,
      location: { search: "" },
      window: {
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          /** @param {string} id */
          requiredElement: (id) => elements.get(id),
        },
      },
    },
    error,
    form,
    status,
    submit,
  };
}

/** @param {Record<string, any>} context */
function executeGitHubBrowserAsset(context) {
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection.js",
    readBrowserAsset("/assets/github-connection.js"),
    context,
  );
}

test("GitHub Connection control has semantic live states, deterministic focus, and submits the exact Manifest form", async () => {
  const page = operatorPage({ view: "repositories" });
  assert.match(
    page,
    /<section aria-labelledby="github-connection-title">.*<form id="github-connection-form">.*<button id="github-connection-submit" type="submit">Connect GitHub App<\/button>.*aria-live="polite" id="github-connection-status" tabindex="-1".*role="alert" tabindex="-1"/,
  );
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(
    page,
    /<script src="\/assets\/github-connection\.js"><\/script>/,
  );

  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const elements = new Map([
    ["github-connection-form", form],
    ["github-connection-submit", submit],
    ["github-connection-status", status],
    ["github-connection-error", error],
  ]);
  /** @type {any[]} */
  const requests = [];
  /** @type {any[]} */
  const externalForms = [];
  const context = {
    URLSearchParams,
    document: {
      body: {
        /** @param {any} value */
        append(value) {
          externalForms.push(value);
        },
      },
      /** @param {string} name */
      createElement(name) {
        if (name === "input") {
          return {};
        }
        /** @type {any[]} */
        const controls = [];
        return {
          action: "",
          method: "",
          controls,
          submitted: false,
          /** @param {any} control */
          append(control) {
            controls.push(control);
          },
          submit() {
            this.submitted = true;
          },
        };
      },
    },
    /** @param {string} path @param {any} options */
    fetch: async (path, options) => {
      requests.push({ options, path });
      if (path === "/api/v1/github-connections") {
        return {
          ok: true,
          async json() {
            return {
              principal: { login: "operator" },
              repository_count: 1,
              verification_history: [{ id: "verification-1" }],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            action: "https://github.com/settings/apps/new",
            manifest: { default_events: [], public: false },
            method: "POST",
            state: "manifest-state",
          };
        },
      };
    },
    location: { search: "?github_connection=connected" },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        /** @param {string} id */
        requiredElement(id) {
          const value = elements.get(id);
          if (!value) {
            throw new Error("missing element");
          }
          return value;
        },
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection.js",
    readBrowserAsset("/assets/github-connection.js"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    status.textContent,
    "operator connected; 1 accessible Repositories; 1 verified history record.",
  );
  assert.equal(status.focused, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/github-connections/manifest",
  });
  assert.equal(externalForms.length, 1);
  assert.equal(externalForms[0].action, "https://github.com/settings/apps/new");
  assert.equal(externalForms[0].method, "POST");
  assert.equal(externalForms[0].submitted, true);
  assert.deepEqual(
    externalForms[0].controls.map(
      /** @param {any} control */ (control) => ({
        name: control.name,
        type: control.type,
        value: control.value,
      }),
    ),
    [
      {
        name: "manifest",
        type: "hidden",
        value: JSON.stringify({ default_events: [], public: false }),
      },
      { name: "state", type: "hidden", value: "manifest-state" },
    ],
  );
});

test("GitHub Connection failure preserves exact owning error, restores the control, and focuses the alert", async () => {
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const elements = new Map([
    ["github-connection-form", form],
    ["github-connection-submit", submit],
    ["github-connection-status", status],
    ["github-connection-error", error],
  ]);
  let request = 0;
  const context = {
    URLSearchParams,
    document: { body: { append() {} }, createElement: () => ({}) },
    fetch: async () => {
      request += 1;
      if (request === 1) {
        return {
          ok: true,
          async json() {
            return null;
          },
        };
      }
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
    },
    location: { search: "" },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        /** @param {string} id */
        requiredElement: (id) => elements.get(id),
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection.js",
    readBrowserAsset("/assets/github-connection.js"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(
    error.textContent,
    "GitHub App permissions do not match the required profile",
  );
  assert.equal(error.hidden, false);
  assert.equal(error.focused, true);
  assert.equal(status.textContent, "");
  assert.equal(submit.disabled, false);
});

test("GitHub Connection loading failures expose one exact error without stale status", async () => {
  const cases = [
    {
      error: "GitHub Connection loading failed",
      fetch: async () => {
        throw new Error("network unavailable");
      },
    },
    {
      error: "GitHub Connection response is invalid",
      fetch: async () => ({
        ok: false,
        async json() {
          return {};
        },
      }),
    },
    {
      error: "GitHub Connection response is invalid",
      fetch: async () => ({
        ok: true,
        async json() {
          return {};
        },
      }),
    },
  ];
  for (const scenario of cases) {
    const browser = browserContext(scenario.fetch);
    executeGitHubBrowserAsset(browser.context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(browser.error.textContent, scenario.error);
    assert.equal(browser.error.hidden, false);
    assert.equal(browser.error.focused, true);
    assert.equal(browser.status.textContent, "");
  }
});

test("GitHub Connection start failures restore the only operator control", async () => {
  let request = 0;
  const browser = browserContext(async () => {
    request += 1;
    if (request === 1) {
      return {
        ok: true,
        async json() {
          return null;
        },
      };
    }
    throw new Error("network unavailable");
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  await browser.form.listener("submit")({ preventDefault() {} });
  assert.equal(
    browser.error.textContent,
    "GitHub App Manifest flow could not start",
  );
  assert.equal(browser.error.focused, true);
  assert.equal(browser.submit.disabled, false);

  let malformedRequest = 0;
  const malformed = browserContext(async () => {
    malformedRequest += 1;
    return {
      ok: true,
      async json() {
        return malformedRequest === 1 ? null : { method: "GET" };
      },
    };
  });
  executeGitHubBrowserAsset(malformed.context);
  await new Promise((resolve) => setImmediate(resolve));
  await malformed.form.listener("submit")({ preventDefault() {} });
  assert.equal(
    malformed.error.textContent,
    "GitHub App Manifest response is invalid",
  );
  assert.equal(malformed.error.focused, true);
  assert.equal(malformed.submit.disabled, false);
});
