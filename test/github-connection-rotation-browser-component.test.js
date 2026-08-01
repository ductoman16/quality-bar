import assert from "node:assert/strict";
import { test } from "node:test";

import {
  browserContext,
  executeGitHubBrowserAsset,
  selectionRequestId,
  verifiedConnection,
} from "./github-connection-browser-component-support.js";

test("GitHub App rotation uses one semantic confirmation and exposes exact success", async () => {
  /** @type {any[]} */
  const requests = [];
  const browser = browserContext(async (path, options) => {
    requests.push({ path, options });
    return path === "/api/v1/github-connections"
      ? {
          ok: true,
          async json() {
            return verifiedConnection();
          },
        }
      : {
          ok: true,
          async json() {
            return verifiedConnection();
          },
        };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(browser.github.rotationForm.hidden, false);
  /** @type {any} */ (browser.github.rotationPem).value =
    "replacement-private-key";
  await browser.github.rotationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({ pem: "replacement-private-key" }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/github-connections/credential/rotate",
  });
  assert.equal(
    browser.status.textContent,
    "GitHub App credentials rotated. Revoke the predecessor in GitHub.",
  );
  assert.equal(browser.status.focused, true);
  assert.equal(/** @type {any} */ (browser.github.rotationPem).value, "");
  assert.equal(browser.github.rotationSubmit.disabled, false);
});

test("GitHub App rotation rejects an empty replacement key with deterministic focus", async () => {
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
  await browser.github.rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(
    browser.error.textContent,
    "Replacement GitHub App private key is required",
  );
  assert.equal(browser.github.rotationPem.focused, true);
  assert.equal(requests.length, 1);
});

test("GitHub App rotation preserves the owning HTTP error and re-enables the control", async () => {
  const browser = browserContext(async (path) => {
    if (path === "/api/v1/github-connections") {
      return {
        ok: true,
        async json() {
          return verifiedConnection();
        },
      };
    }
    return {
      ok: false,
      async json() {
        return {
          error: {
            message: "Replacement GitHub App permissions do not match",
          },
        };
      },
    };
  });
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  /** @type {any} */ (browser.github.rotationPem).value = "replacement-key";
  await browser.github.rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(
    browser.error.textContent,
    "Replacement GitHub App permissions do not match",
  );
  assert.equal(browser.error.focused, true);
  assert.equal(browser.github.rotationSubmit.disabled, false);
});

test("GitHub App rotation cancellation leaves the replacement field focused", async () => {
  const browser = browserContext(
    async () => ({
      ok: true,
      async json() {
        return verifiedConnection();
      },
    }),
    [],
    true,
    selectionRequestId,
    false,
  );
  executeGitHubBrowserAsset(browser.context);
  await new Promise((resolve) => setImmediate(resolve));
  /** @type {any} */ (browser.github.rotationPem).value = "replacement-key";
  await browser.github.rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(browser.github.rotationPem.focused, true);
  assert.equal(browser.github.rotationSubmit.disabled, false);
});
