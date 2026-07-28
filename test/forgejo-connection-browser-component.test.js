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
  const reactivationForm = element();
  const lifecycleForm = element();
  const baseUrl = /** @type {any} */ (
    element({ value: "https://forgejo.example" })
  );
  const token = /** @type {any} */ (element({ value: "operator-created-pat" }));
  const rotationToken = /** @type {any} */ (
    element({ value: "replacement-pat" })
  );
  const reactivationToken = /** @type {any} */ (
    element({ value: "reactivation-pat" })
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
  const reactivationSubmit = element();
  const details = element({ hidden: true });
  const identity = element();
  const lifecycle = element();
  const health = element();
  const profile = element();
  const scopes = element();
  const capabilities = element();
  const latest = element();
  const history = element();
  const retire = element();
  const remove = element();
  const confirmation = /** @type {any} */ (
    element({
      close() {
        this.open = false;
      },
      open: false,
      showModal() {
        this.open = true;
      },
    })
  );
  const confirmationForm = element();
  const confirmationMessage = element();
  const confirmationLabel = element({ hidden: true });
  const confirmationInput = /** @type {any} */ (
    element({ hidden: true, value: "" })
  );
  const confirmationCancel = element();
  const confirmationSubmit = element();
  const status = element();
  const error = element({ hidden: true });
  const controls = new Map([
    ["forgejo-connection-form", form],
    ["forgejo-connection-rotation-form", rotationForm],
    ["forgejo-connection-reactivation-form", reactivationForm],
    ["forgejo-connection-lifecycle-form", lifecycleForm],
    ["forgejo-connection-base-url", baseUrl],
    ["forgejo-connection-token", token],
    ["forgejo-connection-rotation-token", rotationToken],
    ["forgejo-connection-reactivation-token", reactivationToken],
    ["forgejo-connection-details", details],
    ["forgejo-connection-identity", identity],
    ["forgejo-connection-lifecycle", lifecycle],
    ["forgejo-connection-health", health],
    ["forgejo-connection-profile", profile],
    ["forgejo-connection-scopes", scopes],
    ["forgejo-connection-capabilities", capabilities],
    ["forgejo-connection-latest", latest],
    ["forgejo-connection-history", history],
    ["forgejo-connection-retire", retire],
    ["forgejo-connection-delete", remove],
    ["forgejo-connection-confirmation", confirmation],
    ["forgejo-connection-confirmation-form", confirmationForm],
    ["forgejo-connection-confirmation-message", confirmationMessage],
    ["forgejo-connection-confirmation-label", confirmationLabel],
    ["forgejo-connection-confirmation-input", confirmationInput],
    ["forgejo-connection-confirmation-cancel", confirmationCancel],
    ["forgejo-connection-confirmation-submit", confirmationSubmit],
    ["forgejo-connection-repositories", repositories],
    ["forgejo-connection-repository-fieldset", fieldset],
    ["forgejo-connection-submit", submit],
    ["forgejo-connection-rotation-submit", rotationSubmit],
    ["forgejo-connection-reactivation-submit", reactivationSubmit],
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
    lifecycle: "enabled",
    principal: { id: 7, login: "operator" },
    reported_version: "16.0.4",
    scopes: ["read:repository", "write:issue", "write:repository"],
    verification_history: [
      {
        api_profile: "forgejo-v16",
        capabilities: { private_git_read: "verified" },
        error: null,
        id: "verification-1",
        outcome: "success",
        principal: { id: 7, login: "operator" },
        reported_version: "16.0.4",
        repositories: [{ id: 11 }],
        scopes: ["read:repository", "write:issue", "write:repository"],
        trigger: "onboarding",
        verified_at: 1_000,
      },
    ],
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
          if (path.endsWith("/credential/rotate")) {
            return rotationResponse.value;
          }
          if (path.endsWith("/lifecycle")) {
            return options.method === "DELETE"
              ? null
              : { ...validRotationResponse, lifecycle: "retired" };
          }
          if (path.endsWith("/reactivate")) {
            return validRotationResponse;
          }
          return options ? validRotationResponse : null;
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
    "src/browser/forgejo-connection-contract.js",
    readBrowserAsset("/assets/forgejo-connection-contract.js"),
    context,
  );
  const contract = /** @type {any} */ (context.window)
    .qualityBarForgejoConnectionContract;
  assert.equal(
    await contract.forgejoResponseErrorMessage({
      async json() {
        return { error: { message: "Exact lifecycle conflict" } };
      },
    }),
    "Exact lifecycle conflict",
  );
  await assert.rejects(
    () =>
      contract.forgejoResponseErrorMessage({
        async json() {
          return { error: {} };
        },
      }),
    /Forgejo error response is invalid/,
  );
  assert.match(
    contract.forgejoVerificationText({
      error: { code: "forgejo_failed", message: "Forgejo failed" },
      outcome: "error",
      trigger: "enablement",
      verified_at: 2_000,
    }),
    /Forgejo failed \(forgejo_failed\)/,
  );
  executeServedBrowserAsset(
    resolve(import.meta.dirname, ".."),
    "src/browser/forgejo-connection-lifecycle-confirmation.js",
    readBrowserAsset("/assets/forgejo-connection-lifecycle-confirmation.js"),
    context,
  );
  executeServedBrowserAsset(
    resolve(import.meta.dirname, ".."),
    "src/browser/forgejo-connection.js",
    readBrowserAsset("/assets/forgejo-connection.js"),
    context,
  );
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(fieldset.disabled, false);
  assert.equal(repositories.children[0].children[0].focused, true);
  assert.equal(status.textContent, "Forgejo Repositories verified.");
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Select at least one Forgejo Repository");
  assert.equal(repositories.children[0].children[0].focused, true);
  repositories.children[0].children[0].checked = true;
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  assert.equal(requests[2].path, "/api/v1/forgejo-connections");
  assert.equal(status.focused, true);
  assert.equal(token.value, "");
  assert.match(profile.textContent, /forgejo-v16; compatible; 16\.0\.4/);
  assert.match(scopes.textContent, /read:repository/);
  assert.match(capabilities.textContent, /private git read: verified/);
  assert.equal(history.children.length, 1);
  assert.match(history.children[0].textContent, /onboarding/);
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    token: "replacement-pat",
  });
  assert.equal(
    requests[3].path,
    "/api/v1/forgejo-connections/credential/rotate",
  );
  assert.equal(rotationToken.value, "");
  assert.equal(
    status.textContent,
    "Forgejo PAT rotated. Revoke its predecessor in Forgejo.",
  );
  rotationToken.value = "unhealthy-replacement";
  rotationResponse.value = {
    ...validRotationResponse,
    health: "error",
    health_error: {
      code: "forgejo_verification_failed",
      message: "Forgejo verification failed",
    },
  };
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(rotationToken.value, "unhealthy-replacement");
  assert.equal(error.textContent, "Forgejo PAT rotation response is invalid");
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
    { ...validRotationResponse, lifecycle: "unknown" },
    { ...validRotationResponse, principal: null },
    { ...validRotationResponse, principal: { id: "7", login: "operator" } },
    { ...validRotationResponse, principal: { id: 7, login: "" } },
    { ...validRotationResponse, reported_version: "17.0.0" },
    { ...validRotationResponse, scopes: {} },
    { ...validRotationResponse, scopes: [1] },
    { ...validRotationResponse, verification_history: [] },
    {
      ...validRotationResponse,
      verification_history: [{ unexpected: true }],
    },
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
  rotationFailure.value = undefined;
  await confirmationForm.listener("submit")({ preventDefault() {} });
  await retire.listener("click")({});
  await confirmationCancel.listener("click")({});
  assert.equal(confirmation.open, false);
  assert.equal(retire.focused, true);
  await retire.listener("click")({});
  let cancellationPrevented = false;
  await confirmation.listener("cancel")({
    preventDefault() {
      cancellationPrevented = true;
    },
  });
  assert.equal(cancellationPrevented, true);
  assert.equal(retire.focused, true);
  await retire.listener("click")({});
  assert.equal(confirmation.open, true);
  assert.match(confirmationMessage.textContent, /PAT will be destroyed/);
  assert.equal(confirmationSubmit.focused, true);
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(lifecycle.textContent, "Retired");
  assert.equal(reactivationForm.hidden, false);
  assert.equal(status.textContent, "Forgejo Connection retired.");
  await reactivationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    token: "reactivation-pat",
  });
  assert.equal(requests.at(-1).path, "/api/v1/forgejo-connections/reactivate");
  assert.equal(lifecycle.textContent, "Enabled");
  assert.equal(reactivationToken.value, "");
  await remove.listener("click")({});
  assert.equal(confirmationInput.focused, true);
  confirmationInput.value = "delete";
  const requestCount = requests.length;
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(requests.length, requestCount);
  assert.equal(confirmationInput.focused, true);
  confirmationInput.value = "DELETE";
  await confirmationForm.listener("submit")({ preventDefault() {} });
  assert.equal(details.hidden, true);
  assert.equal(form.hidden, false);
  assert.equal(status.textContent, "Forgejo Connection deleted.");
});
