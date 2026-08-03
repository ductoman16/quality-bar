import assert from "node:assert/strict";
import { test } from "node:test";

import {
  browserContext,
  executeGitHubBrowserAsset,
  verifiedConnection,
} from "./github-connection-browser-component-support.js";

test("GitHub Connection lifecycle controls use a focused confirmation and the canonical mutation", async () => {
  /** @type {any[]} */
  const requests = [];
  const browser = browserContext(
    /**
     * @this {any}
     * @param {string} path
     * @param {any} options
     */
    async function (path, options) {
      if (
        path === "/api/v1/github-connections/lifecycle" &&
        this !== browser.context.window
      ) {
        throw new TypeError("Illegal invocation");
      }
      requests.push({ path, options });
      return {
        ok: true,
        async json() {
          return path === "/api/v1/github-connections/lifecycle"
            ? { ...verifiedConnection(), lifecycle: "retired" }
            : verifiedConnection();
        },
      };
    },
  );
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  const retire = browser.github.elements.get("github-connection-retire");
  if (!retire) {
    throw new Error("retire_control_missing");
  }
  await retire.listener("click")({});
  const confirmation = /** @type {any} */ (
    browser.github.elements.get("github-connection-confirmation")
  );
  const confirmationForm = browser.github.elements.get(
    "github-connection-confirmation-form",
  );
  const confirmationSubmit = browser.github.elements.get(
    "github-connection-confirmation-submit",
  );
  if (!confirmation || !confirmationForm || !confirmationSubmit) {
    throw new Error("lifecycle_confirmation_missing");
  }
  assert.equal(confirmation.open, true);
  assert.equal(confirmationSubmit.focused, true);
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), {
    path: "/api/v1/github-connections/lifecycle",
    options: {
      body: JSON.stringify({ lifecycle: "retired" }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
  });
  const lifecycle = browser.github.elements.get("github-connection-lifecycle");
  if (!lifecycle) {
    throw new Error("lifecycle_control_missing");
  }
  assert.equal(lifecycle.textContent, "Retired");
  assert.equal(browser.status.focused, true);
});

test("GitHub Connection lifecycle confirmation prevents cancellation and requires typed deletion", async () => {
  /** @type {any[]} */
  const requests = [];
  const browser = browserContext(async (path, options) => {
    requests.push({ path, options });
    return {
      ok: true,
      async json() {
        return verifiedConnection();
      },
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  const retire = browser.github.elements.get("github-connection-retire");
  const remove = browser.github.elements.get("github-connection-delete");
  if (!retire || !remove) {
    throw new Error("lifecycle_controls_missing");
  }
  const requestCount = requests.length;
  await retire.listener("click")({});
  const message = browser.github.elements.get(
    "github-connection-confirmation-message",
  );
  const cancel = browser.github.elements.get(
    "github-connection-confirmation-cancel",
  );
  const input = /** @type {any} */ (
    browser.github.elements.get("github-connection-confirmation-input")
  );
  const confirmation = browser.github.elements.get(
    "github-connection-confirmation",
  );
  const confirmationForm = browser.github.elements.get(
    "github-connection-confirmation-form",
  );
  const submit = browser.github.elements.get(
    "github-connection-confirmation-submit",
  );
  if (
    !message ||
    !cancel ||
    !confirmation ||
    !input ||
    !confirmationForm ||
    !submit
  ) {
    throw new Error("lifecycle_confirmation_missing");
  }
  assert.match(message.textContent, /GitHub Connection for operator/);
  assert.match(message.textContent, /credential will be destroyed/);
  await cancel.listener("click")({});
  assert.equal(requests.length, requestCount);
  assert.equal(retire.focused, true);
  await retire.listener("click")({});
  await confirmation.listener("cancel")({ preventDefault() {} });
  assert.equal(retire.focused, true);
  await remove.listener("click")({});
  assert.match(message.textContent, /permanently/);
  assert.equal(input.required, true);
  assert.equal(input.focused, true);
  input.value = "delete";
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(requests.length, requestCount);
  assert.equal(input.focused, true);
  input.value = "DELETE";
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(requests.at(-1).options.method, "DELETE");
});

test("a retired GitHub Connection reactivates with a replacement key for the same App", async () => {
  /** @type {any[]} */
  const requests = [];
  const browser = browserContext(async (path, options) => {
    requests.push({ path, options });
    return {
      ok: true,
      async json() {
        return {
          ...verifiedConnection(),
          lifecycle: options?.method === "POST" ? "enabled" : "retired",
        };
      },
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  const pem = /** @type {any} */ (
    browser.github.elements.get("github-connection-pem")
  );
  const label = browser.github.elements.get("github-connection-pem-label");
  if (!pem || !label) {
    throw new Error("github_connection_reactivation_controls_missing");
  }
  assert.equal(pem.hidden, false);
  assert.equal(label.hidden, false);
  assert.equal(pem.required, true);
  pem.value = "replacement-private-key";
  await browser.form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), {
    path: "/api/v1/github-connections/reactivate",
    options: {
      body: JSON.stringify({ pem: "replacement-private-key" }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
  });
  assert.equal(pem.hidden, true);
  assert.equal(label.hidden, true);
  assert.equal(pem.required, false);
  assert.equal(pem.value, "");
  assert.equal(browser.status.textContent, "GitHub Connection reactivated.");
  assert.equal(browser.status.focused, true);
});
