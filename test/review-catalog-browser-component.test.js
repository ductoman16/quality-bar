import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { FakeCustomEvent } from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {Record<string, unknown>} [properties] */
function catalogElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    children: /** @type {unknown[]} */ ([]),
    className: "",
    hidden: false,
    id: "",
    listeners,
    textContent: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    /** @param {...unknown} appended */
    append(...appended) {
      this.children.push(...appended);
    },
    replaceChildren() {
      this.children = [];
    },
    /** @param {string} name */
    getAttribute(name) {
      return /** @type {any} */ (this)[name] ?? null;
    },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
      Object.defineProperty(this, name, {
        configurable: true,
        value,
        writable: true,
      });
    },
  };
}

function catalogReview() {
  return {
    active_version: {
      codex_configuration: { model: "gpt-5.6-terra" },
      criteria: [{ impact: "blocking", instruction: "Keep writes atomic." }],
      number: 1,
    },
    archived: false,
    assignment: { scope: "installation_wide" },
    id: "review/one",
    name: "Executable boundaries",
    versions: [{ number: 1 }],
  };
}

test("the Reviews catalog refetches after an in-place mutation and stays inert when detached", async () => {
  const catalog = catalogElement();
  const loading = catalogElement();
  const empty = catalogElement({ hidden: true });
  const summary = catalogElement();
  const failure = catalogElement({ hidden: true });
  const elements = new Map([
    ["review-catalog", catalog],
    ["review-catalog-loading", loading],
    ["review-catalog-empty", empty],
    ["review-catalog-summary", summary],
    ["review-catalog-error", failure],
    ["review-catalog-filter-active", catalogElement()],
    ["review-catalog-filter-archived", catalogElement()],
  ]);
  /** @type {Map<string, (event: any) => unknown>} */
  const documentListeners = new Map();
  /** @type {string[]} */
  const requests = [];
  /** @type {string[]} */
  const destinations = [];
  let catalogAttached = true;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-catalog.js",
    readBrowserAsset("/assets/review-catalog.js"),
    {
      CustomEvent: FakeCustomEvent,
      document: {
        /** @param {string} name @param {(event: any) => unknown} listener */
        addEventListener(name, listener) {
          documentListeners.set(name, listener);
        },
        /** @param {string} tagName */
        createElement(tagName) {
          return catalogElement({ tagName });
        },
        /** @param {string} id */
        getElementById(id) {
          if (id === "review-catalog" && !catalogAttached) {
            return null;
          }
          return elements.get(id) ?? null;
        },
      },
      /** @param {string} path */
      async fetch(path) {
        requests.push(path);
        return {
          ok: true,
          status: 200,
          async json() {
            return { reviews: [catalogReview()] };
          },
        };
      },
      window: {
        location: {
          /** @param {string} destination */
          assign(destination) {
            destinations.push(destination);
          },
        },
      },
    },
  );

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  systemLoaded(new FakeCustomEvent("quality-bar:system-loaded"));
  await flush();
  assert.deepEqual(requests, ["/api/v1/reviews"]);
  assert.equal(catalog.children.length, 1);
  assert.equal(loading.hidden, true);
  assert.equal(summary.textContent, "1 review · 1 active");

  const reviewUpdated = documentListeners.get("quality-bar:review-updated");
  assert.ok(reviewUpdated);
  reviewUpdated(
    new FakeCustomEvent("quality-bar:review-updated", {
      detail: { review: catalogReview() },
    }),
  );
  await flush();
  assert.deepEqual(requests, ["/api/v1/reviews", "/api/v1/reviews"]);

  catalogAttached = false;
  assert.doesNotThrow(() =>
    reviewUpdated(
      new FakeCustomEvent("quality-bar:review-updated", {
        detail: { review: catalogReview() },
      }),
    ),
  );
  await flush();
  assert.deepEqual(requests, ["/api/v1/reviews", "/api/v1/reviews"]);

  catalogAttached = true;
  const reviewCreated = documentListeners.get("quality-bar:review-created");
  assert.ok(reviewCreated);
  reviewCreated(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: { id: "review/two" },
    }),
  );
  assert.deepEqual(destinations, [
    "/?view=review-detail&review_id=review%2Ftwo",
  ]);
  reviewCreated(new FakeCustomEvent("quality-bar:review-created"));
  await flush();
  assert.deepEqual(requests, [
    "/api/v1/reviews",
    "/api/v1/reviews",
    "/api/v1/reviews",
  ]);
});

test("the catalog filters to archived reviews and restores them in place", async () => {
  const catalog = catalogElement();
  const loading = catalogElement();
  const empty = catalogElement({ hidden: true });
  const summary = catalogElement();
  const failure = catalogElement({ hidden: true });
  const filterArchived = catalogElement();
  const elements = new Map([
    ["review-catalog", catalog],
    ["review-catalog-loading", loading],
    ["review-catalog-empty", empty],
    ["review-catalog-summary", summary],
    ["review-catalog-error", failure],
    ["review-catalog-filter-active", catalogElement()],
    ["review-catalog-filter-archived", filterArchived],
  ]);
  /** @type {Map<string, (event: any) => unknown>} */
  const documentListeners = new Map();
  /** @type {Array<{ path: string, options: any }>} */
  const requests = [];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const archived = { ...catalogReview(), archived: true, id: "review/old" };

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-catalog.js",
    readBrowserAsset("/assets/review-catalog.js"),
    {
      CustomEvent: FakeCustomEvent,
      document: {
        /** @param {string} name @param {(event: any) => unknown} listener */
        addEventListener(name, listener) {
          documentListeners.set(name, listener);
        },
        /** @param {string} tagName */
        createElement(tagName) {
          return catalogElement({ tagName });
        },
        /** @param {string} id */
        getElementById(id) {
          return elements.get(id) ?? null;
        },
      },
      /** @param {string} path @param {any} [options] */
      async fetch(path, options = {}) {
        requests.push({ options, path });
        const list = String(path).includes("state=archived")
          ? [archived]
          : [catalogReview()];
        return {
          ok: true,
          status: 200,
          async json() {
            return { reviews: list };
          },
        };
      },
      window: {
        location: { assign() {} },
        qualityBarOperator: { csrfToken: () => "csrf-token" },
      },
    },
  );

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  systemLoaded(new FakeCustomEvent("quality-bar:system-loaded"));
  await flush();
  assert.equal(requests[0].path, "/api/v1/reviews");

  const archivedClick = filterArchived.listeners.get("click");
  assert.ok(archivedClick);
  archivedClick(/** @type {any} */ ({}));
  await flush();
  assert.equal(requests[1].path, "/api/v1/reviews?state=archived");
  assert.equal(catalog.children.length, 1);
  assert.equal(summary.textContent, "1 review · archived");

  const article = /** @type {any} */ (catalog.children[0]);
  const toggle = article.children[0].children[0];
  toggle.listeners.get("click")(/** @type {any} */ ({}));
  const panel = article.children[1];
  const restore = panel.children[panel.children.length - 1];
  restore.listeners.get("click")(/** @type {any} */ ({}));
  await flush();

  const patch = requests[2];
  assert.equal(patch.path, "/api/v1/reviews/review%2Fold/archival");
  assert.equal(patch.options.method, "PATCH");
  assert.deepEqual(JSON.parse(patch.options.body), { archived: false });
  assert.equal(requests[3].path, "/api/v1/reviews?state=archived");
});
