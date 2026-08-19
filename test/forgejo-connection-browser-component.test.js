import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  assertFailedForgejoReactivationState,
  assertForgejoPage,
  assertForgejoContract,
  assertForgejoLoadFailureState,
  assertForgejoReactivationRequest,
  assertNeverUsedForgejoDeletion,
  assertRegisteredForgejoState,
  assertUncertainForgejoRetirementState,
  failedForgejoReactivation,
  malformedForgejoConnectionResponses,
  validForgejoConnection,
} from "./forgejo-connection-browser-component-support.js";
import { element } from "./github-connection-browser-component-support.js";

test("Forgejo Connection discovers semantic Repository choices then atomically registers checked choices", async () => {
  const page = operatorPage({ view: "repositories" });
  assertForgejoPage(page);
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
  const polling = element();
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
    ["forgejo-connection-polling", polling],
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
  /** @type {{value: Error | undefined}} */
  const currentFailure = { value: undefined };
  const rotationJsonFailure = { value: false };
  const reactivationJsonFailure = { value: false };
  const lifecycleJsonFailure = { value: false };
  const rotationOk = { value: true };
  const reactivationOk = { value: true };
  const validRotationResponse = validForgejoConnection;
  /** @type {{value: unknown}} */
  const rotationResponse = { value: validRotationResponse };
  /** @type {{value: unknown}} */
  const currentResponse = { value: null };
  let ready = () => {};
  const context = {
    Error,
    URL,
    document: { createElement: () => element() },
    fetch: async (/** @type {string} */ path, /** @type {any} */ options) => {
      requests.push({ options, path });
      if (path.endsWith("/credential/rotate") && rotationFailure.value) {
        throw rotationFailure.value;
      }
      if (!options && currentFailure.value) {
        throw currentFailure.value;
      }
      if (path.endsWith("/reactivate")) {
        assert.equal(
          status.textContent,
          "Verifying Forgejo Connection reactivation.",
        );
      }
      if (path.endsWith("/lifecycle")) {
        assert.equal(
          status.textContent,
          options.method === "DELETE"
            ? "Deleting Forgejo Connection."
            : "Retiring Forgejo Connection.",
        );
        assert.equal(retire.disabled, options.method === "PATCH");
        assert.equal(remove.disabled, options.method === "DELETE");
      }
      return {
        ok: path.endsWith("/credential/rotate")
          ? rotationOk.value
          : path.endsWith("/reactivate")
            ? reactivationOk.value
            : true,
        async json() {
          if (
            path.endsWith("/credential/rotate") &&
            rotationJsonFailure.value
          ) {
            throw new SyntaxError("Unexpected token < in JSON");
          }
          if (path.endsWith("/lifecycle") && lifecycleJsonFailure.value) {
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
            if (reactivationJsonFailure.value) {
              throw new SyntaxError("Unexpected token < in JSON");
            }
            return reactivationOk.value
              ? validRotationResponse
              : {
                  error: {
                    message: "Replacement PAT verification failed",
                  },
                };
          }
          return options ? validRotationResponse : currentResponse.value;
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
  await assertForgejoContract(contract);
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
  assertRegisteredForgejoState(controls);
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
  const malformedResponses = malformedForgejoConnectionResponses(
    validRotationResponse,
  );
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
  await assert.rejects(
    () => confirmationForm.listener("submit")({ preventDefault() {} }),
    /Forgejo lifecycle confirmation state is invalid/,
  );
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
  await assertUncertainForgejoRetirementState({
    confirmationForm,
    controls,
    currentResponse,
    lifecycleJsonFailure,
  });
  await reactivationForm.listener("submit")({ preventDefault() {} });
  assertForgejoReactivationRequest(requests);
  assert.equal(lifecycle.textContent, "Enabled");
  assert.equal(reactivationToken.value, "");
  reactivationToken.value = "failed-reactivation-pat";
  reactivationOk.value = false;
  currentResponse.value = failedForgejoReactivation();
  await reactivationForm.listener("submit")({ preventDefault() {} });
  assertFailedForgejoReactivationState(controls);
  currentFailure.value = new Error("Forgejo Connection refresh unavailable");
  await reactivationForm.listener("submit")({ preventDefault() {} });
  assert.equal(details.hidden, true);
  assert.match(error.textContent, /Replacement PAT verification failed/);
  assert.match(error.textContent, /refresh unavailable/);
  currentFailure.value = undefined;
  reactivationOk.value = true;
  reactivationJsonFailure.value = true;
  currentResponse.value = validRotationResponse;
  await reactivationForm.listener("submit")({ preventDefault() {} });
  assert.equal(lifecycle.textContent, "Enabled");
  assert.equal(error.textContent, "Unexpected token < in JSON");
  reactivationJsonFailure.value = false;
  await assertNeverUsedForgejoDeletion({
    confirmationForm,
    confirmationInput,
    controls,
    remove,
    requests,
    retire,
    rotationForm,
    rotationResponse,
    rotationToken,
    status,
  });
  await assertForgejoLoadFailureState({ controls, currentFailure, ready });
});
