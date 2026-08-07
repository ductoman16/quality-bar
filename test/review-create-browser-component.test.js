import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

class FakeCustomEvent {
  /** @param {string} type @param {{detail: unknown}} options */
  constructor(type, options) {
    this.type = type;
    this.detail = options.detail;
  }
}

class BrowserElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName;
    /** @type {BrowserElement[]} */
    this.children = [];
    /** @type {BrowserElement | undefined} */
    this.parent = undefined;
    this.disabled = false;
    this.hidden = false;
    this.htmlFor = "";
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  /** @param {string} name @param {(event: any) => unknown} listener */
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  /** @param {...BrowserElement} children */
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    }
  }

  /** @param {string} selector */
  querySelector(selector) {
    if (selector === "label[for$='-instruction']") {
      return this.children.find(
        (child) =>
          child.tagName === "label" &&
          String(child.htmlFor).endsWith("-instruction"),
      );
    }
    if (selector === "label[for$='-impact']") {
      return this.children.find(
        (child) =>
          child.tagName === "label" &&
          String(child.htmlFor).endsWith("-impact"),
      );
    }
    return this.children.find((child) => child.tagName === selector);
  }

  querySelectorAll() {
    return this.children;
  }

  /** @param {...BrowserElement} children */
  replaceChildren(...children) {
    this.children = children;
    this.value = children[0]?.value ?? "";
  }

  /** @param {string} name */
  listener(name) {
    const listener = this.listeners.get(name);
    if (!listener) {
      throw new Error(`review_create_listener_missing: ${name}`);
    }
    return listener;
  }
}

test("the Review create component submits one complete snapshot and opens its metadata editor", async () => {
  const form = new BrowserElement("form");
  const criteria = new BrowserElement("ol");
  const model = new BrowserElement("select");
  const reasoningEffort = new BrowserElement("select");
  const serviceTier = new BrowserElement("select");
  const addCriterion = new BrowserElement("button");
  const result = new BrowserElement("output");
  const error = new BrowserElement("p");
  error.hidden = true;
  const elements = new Map([
    ["error", error],
    ["review-create-form", form],
    ["review-add-criterion", addCriterion],
    ["review-criteria", criteria],
    ["review-model", model],
    ["review-reasoning-effort", reasoningEffort],
    ["review-service-tier", serviceTier],
    [
      "review-description",
      Object.assign(new BrowserElement("textarea"), {
        value: "Protect public boundaries.",
      }),
    ],
    [
      "review-name",
      Object.assign(new BrowserElement("input"), {
        value: "Public boundaries",
      }),
    ],
    ["review-create-result", result],
  ]);
  form.children = [...elements.values()];
  const documentListeners = new Map();
  /** @type {FakeCustomEvent[]} */
  const dispatchedEvents = [];
  /** @type {{path: string, options: object}[]} */
  const requests = [];
  const document = {
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      documentListeners.set(name, listener);
    },
    cookie: "quality_bar_csrf=csrf-token",
    /** @param {string} tagName */
    createElement(tagName) {
      return new BrowserElement(tagName);
    },
    /** @param {FakeCustomEvent} event */
    dispatchEvent(event) {
      dispatchedEvents.push(event);
    },
    /** @param {string} id */
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    /** @param {string} selector */
    querySelectorAll(selector) {
      return selector === "#review-criteria li" ? criteria.children : [];
    },
  };

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-create.js",
    readBrowserAsset("/assets/review-create.js"),
    {
      CustomEvent: FakeCustomEvent,
      document,
      /** @param {string} path @param {object} options */
      async fetch(path, options) {
        requests.push({ options, path });
        if (requests.length === 2) {
          return {
            ok: false,
            async json() {
              return { error: { message: "Exact Review creation failure" } };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return {
              active_version: { number: 1 },
              description: "Protect public boundaries.",
              id: "review-1",
              name: "Public boundaries",
            };
          },
        };
      },
    },
  );

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  assert.throws(
    () =>
      systemLoaded(
        new FakeCustomEvent("quality-bar:system-loaded", { detail: {} }),
      ),
    /system_loaded_event_invalid/,
  );
  systemLoaded(
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
        csrfCookieName: "quality_bar_csrf",
      },
    }),
  );
  const criterion = criteria.children[0];
  assert.ok(criterion);
  const instruction = criterion.querySelector("textarea");
  const impact = criterion.querySelector("select");
  assert.ok(instruction);
  assert.ok(impact);
  instruction.value = "Keep interfaces explicit.";
  impact.value = "advisory";
  await form.listener("submit")({ preventDefault() {} });

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      options: {
        body: JSON.stringify({
          assignment: { scope: "installation_wide" },
          codex_configuration: {
            model: "gpt-5.6-terra",
            reasoning_effort: "high",
            service_tier: "standard",
          },
          criteria: [
            { impact: "advisory", instruction: "Keep interfaces explicit." },
          ],
          description: "Protect public boundaries.",
          name: "Public boundaries",
        }),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "POST",
      },
      path: "/api/v1/reviews",
    },
  ]);
  assert.equal(result.textContent, "Public boundaries v1 created.");
  assert.equal(dispatchedEvents[0].type, "quality-bar:review-created");
  const createdReview = /** @type {{id: string}} */ (
    dispatchedEvents[0].detail
  );
  assert.equal(createdReview.id, "review-1");

  document.cookie = "";
  await assert.rejects(async () => {
    await form.listener("submit")({ preventDefault() {} });
  }, /browser_csrf_unavailable/);
  document.cookie = "quality_bar_csrf=csrf-token";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Exact Review creation failure");
  assert.equal(error.hidden, false);
});
