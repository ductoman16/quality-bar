import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { element } from "./github-connection-browser-component-support.js";

test("Forgejo Connection discovers semantic Repository choices then atomically registers checked choices", async () => {
  const page = operatorPage({ view: "repositories" });
  assert.match(
    page,
    /<fieldset disabled id="forgejo-connection-repository-fieldset"><legend>Forgejo Repositories<\/legend><div id="forgejo-connection-repositories"><\/div><\/fieldset>.*aria-live="polite" id="forgejo-connection-status" tabindex="-1".*role="alert" tabindex="-1"/,
  );
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  const form = element();
  const rotationForm = element();
  const baseUrl = /** @type {any} */ (
    element({ value: "https://forgejo.example" })
  );
  const token = /** @type {any} */ (element({ value: "operator-created-pat" }));
  const rotationToken = /** @type {any} */ (
    element({ value: "replacement-pat" })
  );
  const repositories = element({
    querySelector() {
      return this.children[0]?.children[0] ?? null;
    },
    querySelectorAll() {
      return this.children
        .map(/** @param {any} label */ (label) => label.children[0])
        .filter(/** @param {any} control */ (control) => control.checked);
    },
  });
  const fieldset = element({ disabled: true });
  const submit = element();
  const rotationSubmit = element();
  const status = element();
  const error = element({ hidden: true });
  const controls = new Map([
    ["forgejo-connection-form", form],
    ["forgejo-connection-rotation-form", rotationForm],
    ["forgejo-connection-base-url", baseUrl],
    ["forgejo-connection-token", token],
    ["forgejo-connection-rotation-token", rotationToken],
    ["forgejo-connection-repositories", repositories],
    ["forgejo-connection-repository-fieldset", fieldset],
    ["forgejo-connection-submit", submit],
    ["forgejo-connection-rotation-submit", rotationSubmit],
    ["forgejo-connection-status", status],
    ["forgejo-connection-error", error],
  ]);
  /** @type {any[]} */
  const requests = [];
  /** @type {{value: Error | undefined}} */
  const rotationFailure = { value: undefined };
  const rotationJsonFailure = { value: false };
  const rotationOk = { value: true };
  const validRotationResponse = {
    api_profile: "forgejo-v16",
    base_url: "https://forgejo.example",
    capabilities: { private_git_read: "verified" },
    health: "healthy",
    health_error: null,
    id: "forgejo-connection",
    principal: { id: 7, login: "operator" },
    reported_version: "16.0.4",
    scopes: ["read:repository", "write:issue", "write:repository"],
    verified_at: 1_000,
  };
  /** @type {{value: unknown}} */
  const rotationResponse = { value: validRotationResponse };
  let ready = () => {};
  const context = {
    Error,
    document: { createElement: () => element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      requests.push({ options, path });
      if (path.endsWith("/credential/rotate") && rotationFailure.value) {
        throw rotationFailure.value;
      }
      return {
        ok: path.endsWith("/credential/rotate") ? rotationOk.value : true,
        async json() {
          if (
            path.endsWith("/credential/rotate") &&
            rotationJsonFailure.value
          ) {
            throw new SyntaxError("Unexpected token < in JSON");
          }
          if (path.endsWith("/discover")) {
            return [{ full_name: "operator/private", id: 11 }];
          }
          return path.endsWith("/credential/rotate")
            ? rotationResponse.value
            : { id: "forgejo-connection" };
        },
      };
    },
    window: {
      confirm(/** @type {string} */ message) {
        assert.match(message, /Revoke the predecessor in Forgejo/);
        return true;
      },
      addEventListener(
        /** @type {string} */ name,
        /** @type {() => void} */ listener,
      ) {
        assert.equal(name, "DOMContentLoaded");
        ready = listener;
      },
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        requiredElement: (/** @type {string} */ id) => controls.get(id),
      },
    },
  };
  executeServedBrowserAsset(
    resolve(import.meta.dirname, ".."),
    "src/browser/forgejo-connection.js",
    readBrowserAsset("/assets/forgejo-connection.js"),
    context,
  );
  ready();
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(fieldset.disabled, false);
  assert.equal(repositories.children[0].children[0].focused, true);
  assert.equal(status.textContent, "Forgejo Repositories verified.");
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Select at least one Forgejo Repository");
  assert.equal(repositories.children[0].children[0].focused, true);
  repositories.children[0].children[0].checked = true;
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  assert.equal(requests[1].path, "/api/v1/forgejo-connections");
  assert.equal(status.focused, true);
  assert.equal(token.value, "");
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    token: "replacement-pat",
  });
  assert.equal(
    requests[2].path,
    "/api/v1/forgejo-connections/credential/rotate",
  );
  assert.equal(rotationToken.value, "");
  assert.equal(
    status.textContent,
    "Forgejo PAT rotated. Revoke its predecessor in Forgejo.",
  );
  const malformedResponses = [
    null,
    [],
    { ...validRotationResponse, api_profile: "forgejo-v17" },
    { ...validRotationResponse, base_url: "" },
    { ...validRotationResponse, capabilities: null },
    { ...validRotationResponse, capabilities: [] },
    { ...validRotationResponse, health: "error" },
    { ...validRotationResponse, health_error: { code: "stale" } },
    { ...validRotationResponse, id: "" },
    { ...validRotationResponse, principal: null },
    { ...validRotationResponse, principal: { id: "7", login: "operator" } },
    { ...validRotationResponse, principal: { id: 7, login: "" } },
    { ...validRotationResponse, reported_version: "17.0.0" },
    { ...validRotationResponse, scopes: {} },
    { ...validRotationResponse, scopes: [1] },
    { ...validRotationResponse, verified_at: "now" },
    { ...validRotationResponse, unexpected: true },
  ];
  for (const [index, malformed] of malformedResponses.entries()) {
    rotationToken.value = `malformed-replacement-${index}`;
    rotationResponse.value = malformed;
    await rotationForm.listener("submit")({ preventDefault() {} });
    assert.equal(rotationToken.value, `malformed-replacement-${index}`);
    assert.equal(error.textContent, "Forgejo PAT rotation response is invalid");
    assert.equal(error.focused, true);
  }
  rotationResponse.value = validRotationResponse;
  for (const ok of [true, false]) {
    rotationToken.value = `invalid-json-${ok}`;
    rotationOk.value = ok;
    rotationJsonFailure.value = true;
    await rotationForm.listener("submit")({ preventDefault() {} });
    assert.equal(rotationToken.value, `invalid-json-${ok}`);
    assert.equal(error.textContent, "Forgejo PAT rotation response is invalid");
    assert.equal(error.focused, true);
    assert.equal(rotationSubmit.disabled, false);
  }
  rotationOk.value = true;
  rotationJsonFailure.value = false;
  rotationResponse.value = validRotationResponse;
  rotationToken.value = "another-replacement-pat";
  rotationFailure.value = new Error("Forgejo rotation transport failed");
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(status.textContent, "");
  assert.equal(error.textContent, "Forgejo rotation transport failed");
  assert.equal(error.hidden, false);
  assert.equal(error.focused, true);
  assert.equal(rotationSubmit.disabled, false);
});
