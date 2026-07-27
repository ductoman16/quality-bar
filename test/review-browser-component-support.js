/** @param {Record<string, unknown>} [properties] */
export function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    children: /** @type {unknown[]} */ ([]),
    disabled: false,
    focused: false,
    hidden: false,
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    focus() {
      this.focused = true;
    },
    /** @param {...unknown} children */
    replaceChildren(...children) {
      this.children = children;
    },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
      Object.defineProperty(this, name, {
        configurable: true,
        value,
        writable: true,
      });
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`review_metadata_listener_missing: ${name}`);
      }
      return listener;
    },
  };
}

/** @param {string} code @param {string} message @param {number} status */
export function failureResponse(code, message, status) {
  return {
    ok: false,
    status,
    async json() {
      return { error: { code, message } };
    },
  };
}

/** @param {{id: string, name: string, description: string}} metadata */
export function reviewResource(metadata) {
  return {
    active_version: {
      applicability_rule: null,
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        {
          id: metadata.id + "-criterion",
          impact: "advisory",
          instruction: "Preserve the exact metadata boundary.",
          position: 1,
        },
      ],
      id: metadata.id + "-v1",
      number: 1,
    },
    assignment: { scope: "installation_wide" },
    ...metadata,
  };
}

export function reviewVersionBrowserHarness() {
  const form = browserElement({ hidden: true });
  const selector = browserElement();
  const model = browserElement();
  const reasoningEffort = browserElement();
  const serviceTier = browserElement();
  const applicabilityRule = browserElement();
  const criteriaList = browserElement();
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
    ["review-version-criteria", criteriaList],
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
  created.active_version.criteria = [
    {
      id: "criterion-stable-one",
      impact: "advisory",
      instruction: "Preserve the exact metadata boundary.",
      position: 1,
    },
    {
      id: "criterion-stable-two",
      impact: "blocking",
      instruction: "Keep durable writes atomic.",
      position: 2,
    },
  ];
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
  /** @type {(response: object) => void} */
  let resolveFirstSave = () => {
    throw new Error("first_save_not_started");
  };
  const firstSave = new Promise((resolvePromise) => {
    resolveFirstSave = resolvePromise;
  });
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
  const browserContext = {
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
      if (responseNumber === 2) {
        return firstSave;
      }
      if (responseNumber === 4) {
        return failureResponse(
          "review_criterion_instruction_invalid",
          "Criterion 1 instruction must be nonblank",
          422,
        );
      }
      if (responseNumber === 5) {
        return failureResponse(
          "storage_unavailable",
          "Review storage is unavailable",
          503,
        );
      }
      if (responseNumber === 6) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {};
          },
        };
      }
      if (responseNumber === 7) {
        return failureResponse(
          "authentication_required",
          "Authentication is required",
          401,
        );
      }
      if (responseNumber === 8) {
        return failureResponse(
          "storage_unavailable",
          "Review storage is unavailable",
          503,
        );
      }
      if (responseNumber === 9) {
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
  };
  for (const sourcePath of [
    "src/browser/review-criteria.js",
    "src/browser/review-version-contract.js",
    "src/browser/review-version.js",
  ]) {
    executeServedBrowserAsset(
      repositoryRoot,
      sourcePath,
      readBrowserAsset("/assets/" + sourcePath.split("/").at(-1)),
      browserContext,
    );
  }
  return {
    applicabilityRule,
    created,
    criteriaList,
    destinations,
    document,
    documentListeners,
    error,
    form,
    model,
    reasoningEffort,
    requests,
    resolveFirstSave,
    result,
    saved,
    selector,
    serviceTier,
  };
}
import { resolve } from "node:path";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {string} source @param {object} context */
export function runLoginInNewContext(source, context) {
  return executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/login.js",
    source,
    context,
  );
}

/** @param {string} source @param {object} context */
export function runOperatorInNewContext(source, context) {
  return executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    source,
    context,
  );
}

export class FakeCustomEvent {
  /** @param {string} type @param {{detail?: unknown}} [options] */
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}
