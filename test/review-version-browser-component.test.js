import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  failureResponse,
  reviewResource,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

class FakeCustomEvent {
  /** @param {string} type @param {{detail?: unknown}} [options] */
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

test("the Review Version component submits the selected complete executable snapshot", async () => {
  const form = browserElement({
    hidden: true,
    querySelectorAll() {
      return [];
    },
  });
  const selector = browserElement();
  const model = browserElement();
  const reasoningEffort = browserElement();
  const serviceTier = browserElement();
  const applicabilityRule = browserElement();
  const result = browserElement();
  const submit = browserElement();
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
    ["review-version-form", form],
    ["review-version-review", selector],
    ["review-version-id", browserElement()],
    ["review-version-applicability-rule", applicabilityRule],
    ["review-version-model", model],
    ["review-version-reasoning-effort", reasoningEffort],
    ["review-version-service-tier", serviceTier],
    ["review-version-submit", submit],
    ["review-version-result", result],
  ]);
  const documentListeners = new Map();
  /** @type {{path: string, options?: object}[]} */
  const requests = [];
  /** @type {string[]} */
  const destinations = [];
  const created = reviewResource({
    description: "Protect executable boundaries.",
    id: "review/one",
    name: "Executable boundaries",
  });
  const saved = {
    ...created,
    active_version: {
      ...created.active_version,
      applicability_rule: "true",
      codex_configuration: {
        model: "gpt-5.6-sol",
        reasoning_effort: "xhigh",
        service_tier: "fast",
      },
      id: "review/one-v2",
      number: 2,
    },
  };
  let responseNumber = 0;
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

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-version.js",
    readBrowserAsset("/assets/review-version.js"),
    {
      CustomEvent: FakeCustomEvent,
      document,
      location: {
        /** @param {string} destination */
        assign(destination) {
          destinations.push(destination);
        },
        pathname: "/",
        search: "?view=reviews",
      },
      /** @param {string} path @param {object} [options] */
      async fetch(path, options) {
        requests.push({ options, path });
        responseNumber += 1;
        if (responseNumber === 1) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { reviews: [created] };
            },
          };
        }
        if (responseNumber === 4) {
          return failureResponse(
            "review_version_request_malformed",
            "Exact Review Version failure",
            422,
          );
        }
        if (responseNumber === 5) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {};
            },
          };
        }
        if (responseNumber === 6) {
          return failureResponse(
            "authentication_required",
            "Authentication is required",
            401,
          );
        }
        if (responseNumber === 7) {
          return failureResponse(
            "storage_unavailable",
            "Review storage is unavailable",
            503,
          );
        }
        if (responseNumber === 8) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { reviews: "invalid" };
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              changed: responseNumber !== 3,
              review: saved,
            };
          },
        };
      },
    },
  );

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  await assert.rejects(
    async () => systemLoaded({}),
    /system_loaded_event_invalid/,
  );
  await assert.rejects(
    async () =>
      systemLoaded(
        new FakeCustomEvent("quality-bar:system-loaded", { detail: {} }),
      ),
    /system_loaded_event_invalid/,
  );
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
  assert.equal(form.hidden, false, String(error.textContent));
  assert.equal(selector.value, "review/one");
  assert.equal(model.value, "gpt-5.6-terra");
  assert.equal(reasoningEffort.value, "high");
  assert.equal(serviceTier.value, "standard");
  assert.equal(applicabilityRule.value, "");

  model.value = "gpt-5.6-sol";
  model.listener("change")({});
  applicabilityRule.value = "true";
  await form.listener("submit")({ preventDefault() {} });

  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({
        applicability_rule: "true",
        codex_configuration: {
          model: "gpt-5.6-sol",
          reasoning_effort: "xhigh",
          service_tier: "fast",
        },
        criteria: [
          {
            id: "review/one-criterion",
            impact: "advisory",
            instruction: "Preserve the exact metadata boundary.",
          },
        ],
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/reviews/review%2Fone/versions",
  });
  assert.equal(result.textContent, "Executable boundaries v2 active.");
  assert.equal(error.hidden, true);

  const staleReviewCreated = documentListeners.get(
    "quality-bar:review-created",
  );
  assert.ok(staleReviewCreated);
  staleReviewCreated(
    new FakeCustomEvent("quality-bar:review-created", { detail: created }),
  );
  model.value = "gpt-5.6-sol";
  model.listener("change")({});
  applicabilityRule.value = "true";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(result.textContent, "Executable boundaries v2 unchanged.");
  assert.equal(error.hidden, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Exact Review Version failure");
  assert.equal(error.hidden, false);
  assert.equal(result.textContent, "");

  document.cookie = "";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "browser_csrf_unavailable");
  document.cookie = "quality_bar_configured_csrf=csrf-token";

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Review Version response was invalid");
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(destinations, ["/?return_to=%2F%3Fview%3Dreviews"]);

  const reviewCreated = documentListeners.get("quality-bar:review-created");
  assert.ok(reviewCreated);
  assert.throws(() => reviewCreated({}), /review_created_event_invalid/);
  reviewCreated(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: reviewResource({
        description: "A second Review.",
        id: "review-two",
        name: "Second Review",
      }),
    }),
  );
  assert.equal(selector.value, "review-two");
  selector.value = "missing-review";
  assert.throws(
    () => selector.listener("change")({}),
    /review_selection_invalid/,
  );
  model.value = "missing-model";
  assert.throws(
    () => model.listener("change")({}),
    /Review model capability is unavailable/,
  );

  const catalog = {
    models: [
      {
        id: "gpt-5.6-terra",
        reasoning_efforts: ["high"],
        service_tiers: ["standard"],
      },
    ],
  };
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: { catalog },
    }),
  );
  assert.equal(error.textContent, "Review storage is unavailable");
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", {
      detail: { catalog },
    }),
  );
  assert.equal(error.textContent, "Review Version response was invalid");
});
