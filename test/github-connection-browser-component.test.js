import assert from "node:assert/strict";
import { test } from "node:test";
import { operatorPage } from "../src/browser-pages.js";
import {
  browserContext,
  element,
  executeGitHubBrowserAsset,
  githubElements,
  selectionRequestId,
  verifiedConnection,
} from "./github-connection-browser-component-support.js";
test("GitHub Connection control has semantic live states, deterministic focus, and submits the exact Manifest form", async () => {
  const page = operatorPage({ view: "repositories" });
  assert.match(
    page,
    /<section aria-labelledby="github-connection-title">.*<form id="github-connection-form">.*<textarea hidden id="github-connection-pem"><\/textarea>.*<button id="github-connection-submit" type="submit">Connect GitHub App<\/button>.*<dl>.*<dt>Identity<\/dt>.*<dt>API profile<\/dt>.*<dt>Health<\/dt>.*<dt>Permissions<\/dt>.*<dt>Capabilities<\/dt>.*<dt>Latest verification<\/dt>.*<h4>Verification history<\/h4>.*<form hidden id="github-repository-selection-form">.*<fieldset id="github-repository-selection-fieldset">.*<legend>GitHub Repositories<\/legend>.*<button id="github-repository-selection-submit" type="submit">Register selected Repositories<\/button>.*aria-live="polite" id="github-connection-status" tabindex="-1".*role="alert" tabindex="-1"/,
  );
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /thead\{position:absolute/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(
    page,
    /<script src="\/assets\/github-connection\.js"><\/script>/,
  );
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const github = githubElements(form, submit, status, error);
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
    /**
     * @this {any}
     * @param {string} path
     * @param {any} options
     */
    async fetch(path, options) {
      if (this?.form || this?.retire) {
        throw new TypeError("Illegal invocation");
      }
      requests.push({ options, path });
      if (path === "/api/v1/github-connections") {
        return {
          ok: true,
          async json() {
            return verifiedConnection();
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            action: "https://github.com/settings/apps/new?state=manifest-state",
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
          const value = github.elements.get(id);
          if (!value) {
            throw new Error("missing element");
          }
          return value;
        },
      },
    },
  };
  executeGitHubBrowserAsset(context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.textContent, "GitHub Connection verified.");
  assert.equal(status.focused, true);
  assert.equal(github.details.hidden, false);
  assert.equal(form.hidden, true);
  assert.equal(github.identity.textContent, "operator");
  assert.equal(
    github.profile.textContent,
    "github-rest:2026-03-10; compatible",
  );
  assert.equal(github.health.textContent, "Verified");
  assert.equal(github.permissions.textContent, "contents: read");
  assert.equal(github.capabilities.textContent, "private git read");
  assert.equal(github.latest.textContent, "1970-01-01T00:00:01.000Z");
  assert.equal(
    github.history.children[0].textContent,
    "onboarding; success; Repository checks 101: success; 1 enumerated Repositories; 1970-01-01T00:00:01.000Z",
  );
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
  assert.equal(
    externalForms[0].action,
    "https://github.com/settings/apps/new?state=manifest-state",
  );
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
    ],
  );
});
test("GitHub Repository selection is a single accessible atomic mutation with deterministic pending, success, and invalid focus", async () => {
  /** @type {any[]} */
  const requests = [];
  const browser = browserContext(async (path, options) => {
    requests.push({ options, path });
    if (path === "/api/v1/github-connections") {
      return {
        ok: true,
        async json() {
          return verifiedConnection();
        },
      };
    }
    return {
      ok: true,
      async json() {
        return [
          {
            forge_repository_id: 101,
          },
        ];
      },
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(browser.github.repositoryForm.hidden, false);
  assert.equal(browser.github.repositoryOptions.children.length, 1);
  const label = browser.github.repositoryOptions.children[0];
  const control = label.children[0];
  assert.equal(control.name, "repository_ids");
  assert.equal(control.type, "checkbox");
  assert.equal(control.value, "101");
  assert.equal(label.children[1].textContent, "operator/private; private");
  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });
  assert.equal(
    browser.error.textContent,
    "Select at least one GitHub Repository",
  );
  assert.equal(control.focused, true);
  assert.equal(requests.length, 1);
  control.checked = true;
  await browser.github.repositoryForm.listener("submit")({
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({
        repository_ids: [101],
        request_id: selectionRequestId,
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/github-connections/repositories",
  });
  assert.equal(browser.github.repositorySubmit.disabled, true);
  assert.equal(browser.context.location.assigned, "/?view=repositories");
  assert.equal(browser.status.textContent, "GitHub Repositories registered.");
  assert.equal(browser.status.focused, true);
});
test("GitHub Connection failure preserves exact owning error, restores the control, and focuses the alert", async () => {
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const github = githubElements(form, submit, status, error);
  let request = 0;
  const context = {
    URLSearchParams,
    document: { body: { append() {} }, createElement: () => element() },
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
        requiredElement: (id) => github.elements.get(id),
      },
    },
  };
  executeGitHubBrowserAsset(context);
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
test("GitHub callback failure returns to and focuses the exact operator error", async () => {
  let consumed = false;
  /** @param {string} path */
  const fetch = async (path) => ({
    ok: true,
    async json() {
      if (path === "/api/v1/github-connections") {
        return null;
      }
      if (
        path ===
          "/api/v1/github-connections/callback-error?receipt=error-receipt" &&
        !consumed
      ) {
        consumed = true;
        return {
          code: "github_permissions_mismatch",
          message: "GitHub App permissions do not match the required profile",
        };
      }
      return null;
    },
  });
  const browser = browserContext(fetch);
  browser.context.location.search =
    "?view=repositories&github_connection_error=error-receipt";
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    browser.error.textContent,
    "GitHub App permissions do not match the required profile (github_permissions_mismatch)",
  );
  assert.equal(browser.error.focused, true);
  assert.equal(browser.status.textContent, "");
  assert.deepEqual(browser.replacedUrls, ["/?view=repositories"]);
  const reload = browserContext(fetch);
  reload.context.location.search =
    "?view=repositories&github_connection_error=error-receipt";
  executeGitHubBrowserAsset(reload.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reload.error.hidden, true);
  assert.equal(reload.error.textContent, "");
  assert.deepEqual(reload.replacedUrls, ["/?view=repositories"]);
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
