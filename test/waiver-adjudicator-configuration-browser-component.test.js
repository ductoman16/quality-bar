import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.js";
import {
  browserElement,
  FakeCustomEvent,
  failureResponse,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourcePath = "src/browser/waiver-adjudicator-configuration.js";
const source = readFileSync(resolve(repositoryRoot, sourcePath), "utf8");

test("the System page exposes one semantic narrow-layout Waiver Adjudicator Configuration form", () => {
  assert.doesNotThrow(
    () =>
      new Script(
        [
          readBrowserAsset("/assets/operator.js"),
          readBrowserAsset("/assets/waiver-adjudicator-configuration.js"),
        ].join("\n"),
      ),
  );
  const page = operatorPage({ view: "system" });
  assert.match(
    page,
    /<form hidden id="waiver-adjudicator-configuration-form">.*<label for="waiver-adjudicator-model">Model<\/label>.*<label for="waiver-adjudicator-reasoning-effort">Reasoning effort<\/label>.*<label for="waiver-adjudicator-service-tier">Service tier<\/label>/,
  );
  assert.match(
    page,
    /<output aria-label="Waiver Adjudicator Configuration status" aria-live="polite" id="waiver-adjudicator-configuration-status"><\/output><p hidden id="waiver-adjudicator-configuration-error" role="alert" tabindex="-1"><\/p>/,
  );
  assert.match(FONO_LCD_STYLE, /@media/);
  assert.match(
    page,
    /<script src="\/assets\/waiver-adjudicator-configuration\.js"><\/script>/,
  );
});

/** @param {{responses?: any[]}} [options] */
function harness(options = {}) {
  const form = browserElement({ hidden: true });
  const model = browserElement();
  const reasoningEffort = browserElement();
  const serviceTier = browserElement();
  const submit = browserElement();
  const status = browserElement();
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
    ["waiver-adjudicator-configuration-form", form],
    ["waiver-adjudicator-model", model],
    ["waiver-adjudicator-reasoning-effort", reasoningEffort],
    ["waiver-adjudicator-service-tier", serviceTier],
    ["waiver-adjudicator-configuration-submit", submit],
    ["waiver-adjudicator-configuration-status", status],
    ["waiver-adjudicator-configuration-error", error],
  ]);
  const documentListeners = new Map();
  /** @type {{path: string, options?: any}[]} */
  const requests = [];
  const responses = options.responses ?? [
    {
      ok: true,
      status: 200,
      async json() {
        return {
          configured: true,
          configuration: {
            model: "gpt-5.6-terra",
            reasoning_effort: "high",
            service_tier: "standard",
          },
        };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return {
          changed: true,
          configuration: {
            model: "gpt-5.6-sol",
            reasoning_effort: "xhigh",
            service_tier: "fast",
          },
        };
      },
    },
    failureResponse(
      "codex_service_tier_unsupported",
      "Codex service tier is not supported by the selected model",
      422,
    ),
  ];
  const document = {
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      documentListeners.set(name, listener);
    },
    cookie: "quality_bar_configured_csrf=csrf-token",
    /** @param {string} tagName */
    createElement(tagName) {
      return browserElement({ tagName });
    },
    /** @param {string} id */
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
  executeServedBrowserAsset(repositoryRoot, sourcePath, source, {
    CustomEvent: FakeCustomEvent,
    document,
    /** @param {string} path @param {any} options */
    fetch: async (path, options) => {
      requests.push({ options, path });
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  });
  return {
    documentListeners,
    error,
    form,
    model,
    reasoningEffort,
    requests,
    serviceTier,
    status,
    submit,
  };
}

test("the System component saves one exact compatible Waiver Adjudicator Configuration", async () => {
  const {
    documentListeners,
    error,
    form,
    model,
    reasoningEffort,
    requests,
    serviceTier,
    status,
    submit,
  } = harness();
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);

  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
            {
              id: "gpt-5.6-sol",
              reasoning_efforts: ["xhigh"],
              service_tiers: ["fast"],
            },
          ],
        },
      },
    }),
  );
  assert.equal(form.hidden, false);
  assert.equal(model.value, "gpt-5.6-terra");
  assert.equal(reasoningEffort.value, "high");
  assert.equal(serviceTier.value, "standard");
  assert.equal(status.textContent, "Configured");

  model.value = "gpt-5.6-sol";
  model.listener("change")({});
  assert.equal(reasoningEffort.value, "");
  assert.equal(serviceTier.value, "");
  reasoningEffort.value = "xhigh";
  serviceTier.value = "fast";
  const saving = form.listener("submit")({ preventDefault() {} });
  assert.equal(status.textContent, "Saving");
  assert.equal(submit.disabled, true);
  await saving;
  assert.equal(submit.disabled, false);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    service_tier: "fast",
  });
  assert.equal(requests[1].options.headers["x-quality-bar-csrf"], "csrf-token");
  assert.equal(requests[1].options.method, "PATCH");
  assert.equal(status.textContent, "Saved");
  assert.equal(error.hidden, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    "codex_service_tier_unsupported: Codex service tier is not supported by the selected model",
  );
  assert.equal(serviceTier.focused, true);
  assert.equal(status.textContent, "Failed");
});

test("the System component leaves an unconfigured installation without inferred selections", async () => {
  const {
    documentListeners,
    form,
    model,
    reasoningEffort,
    serviceTier,
    status,
  } = harness({
    responses: [
      {
        ok: true,
        status: 200,
        async json() {
          return { configured: false };
        },
      },
    ],
  });
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);

  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
          ],
        },
      },
    }),
  );

  assert.equal(form.hidden, false);
  assert.equal(model.value, "");
  assert.equal(model.disabled, false);
  assert.equal(reasoningEffort.value, "");
  assert.equal(reasoningEffort.disabled, true);
  assert.equal(serviceTier.value, "");
  assert.equal(serviceTier.disabled, true);
  assert.equal(status.textContent, "Not configured");
});

test("the System component prevents mutation while its initial configuration is loading", async () => {
  /** @type {(value: any) => void} */
  let resolveResponse = () => {
    throw new Error("pending_response_not_initialized");
  };
  const pendingResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const { documentListeners, model, status, submit } = harness({
    responses: [pendingResponse],
  });
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);

  const loading = systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
          ],
        },
      },
    }),
  );
  assert.equal(status.textContent, "Loading");
  assert.equal(model.disabled, true);
  assert.equal(submit.disabled, true);

  resolveResponse({
    ok: true,
    status: 200,
    async json() {
      return { configured: false };
    },
  });
  await loading;

  assert.equal(model.disabled, false);
  assert.equal(submit.disabled, false);
  assert.equal(status.textContent, "Not configured");
});

test("the System component permits exact replacement of an obsolete saved configuration", async () => {
  const {
    documentListeners,
    error,
    model,
    reasoningEffort,
    serviceTier,
    submit,
  } = harness({
    responses: [
      failureResponse(
        "codex_model_unsupported",
        "Codex model is not supported",
        422,
      ),
    ],
  });
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);

  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
          ],
        },
      },
    }),
  );

  assert.equal(
    error.textContent,
    "codex_model_unsupported: Codex model is not supported",
  );
  assert.equal(model.value, "");
  assert.equal(model.disabled, false);
  assert.equal(model.focused, true);
  assert.equal(reasoningEffort.value, "");
  assert.equal(reasoningEffort.disabled, true);
  assert.equal(serviceTier.value, "");
  assert.equal(serviceTier.disabled, true);
  assert.equal(submit.disabled, false);
});

test("the System component surfaces and focuses an exact transport failure", async () => {
  const { documentListeners, error, model, status, submit } = harness({
    responses: [new Error("network unavailable")],
  });
  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);

  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: {
        catalog: {
          models: [
            {
              id: "gpt-5.6-terra",
              reasoning_efforts: ["high"],
              service_tiers: ["standard"],
            },
          ],
        },
      },
    }),
  );

  assert.equal(status.textContent, "Failed");
  assert.equal(
    error.textContent,
    "waiver_adjudicator_configuration_request_failed: network unavailable",
  );
  assert.equal(error.hidden, false);
  assert.equal(error.focused, true);
  assert.equal(model.disabled, true);
  assert.equal(submit.disabled, true);
});
