import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  failureResponse,
  FakeCustomEvent,
  reviewResource,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Review lifecycle surface confirms archive and restores the same lineage", async () => {
  const form = browserElement({ hidden: true });
  const state = browserElement({ value: "active" });
  const selector = browserElement();
  const submit = browserElement();
  const deleteButton = browserElement();
  const result = browserElement();
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
    ["review-archival-form", form],
    ["review-archival-state", state],
    ["review-archival-review", selector],
    ["review-archival-submit", submit],
    ["review-archival-result", result],
    ["review-delete", deleteButton],
  ]);
  const listeners = new Map();
  const active = reviewResource({
    description: "Keep lifecycle state explicit.",
    id: "review/one",
    name: "Review lifecycle",
  });
  active.deletion_eligible = false;
  const archived = { ...active, archived: true };
  /** @type {Array<{path: string, options?: object}>} */
  const requests = [];
  /** @type {string[]} */
  const confirmations = [];
  const confirmationDecisions = [false, true, true, true];
  /** @type {string[]} */
  const destinations = [];
  const responses = [
    {
      ok: true,
      status: 200,
      async json() {
        return { reviews: [active] };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return { changed: true, review: archived };
      },
    },
    failureResponse(
      "storage_unavailable",
      "Review storage is unavailable",
      503,
    ),
    {
      ok: true,
      status: 200,
      async json() {
        return { changed: true, review: active };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return { reviews: "invalid" };
      },
    },
  ];
  const document = {
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
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
  const context = {
    CustomEvent: FakeCustomEvent,
    /** @param {string} message */
    confirm(message) {
      confirmations.push(message);
      const decision = confirmationDecisions.shift();
      if (decision === undefined) {
        throw new Error("unexpected Review archival confirmation");
      }
      return decision;
    },
    document,
    /** @param {string} path @param {object} [options] */
    async fetch(path, options) {
      requests.push({ options, path });
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected Review archival request");
      }
      return response;
    },
    location: {
      /** @param {string} destination */
      assign(destination) {
        destinations.push(destination);
      },
      pathname: "/",
      search: "?view=reviews",
    },
    window: {},
  };
  for (const sourcePath of [
    "src/browser/review-version-contract.js",
    "src/browser/review-archival.js",
  ]) {
    executeServedBrowserAsset(
      repositoryRoot,
      sourcePath,
      readBrowserAsset("/assets/" + sourcePath.split("/").at(-1)),
      context,
    );
  }

  const systemLoaded = listeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  await systemLoaded(
    new FakeCustomEvent("quality-bar:system-loaded", { detail: {} }),
  );
  assert.equal(form.hidden, false);
  assert.equal(selector.value, active.id);
  assert.equal(submit.textContent, "Archive");
  assert.equal(deleteButton.disabled, true);

  await submit.listener("click")({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(state.value, "active");
  assert.equal(submit.textContent, "Archive");

  await submit.listener("click")({ preventDefault() {} });

  assert.deepEqual(confirmations, [
    'Archive Review "Review lifecycle"? It will be excluded from new Evaluations.',
    'Archive Review "Review lifecycle"? It will be excluded from new Evaluations.',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({ archived: true }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
    path: "/api/v1/reviews/review%2Fone/archival",
  });
  assert.equal(state.value, "archived");
  assert.equal(submit.textContent, "Restore");
  assert.equal(result.textContent, "Review lifecycle archived.");
  assert.equal(error.hidden, true);

  await submit.listener("click")({ preventDefault() {} });
  assert.equal(error.textContent, "Review storage is unavailable");
  assert.equal(result.textContent, "");
  assert.equal(submit.textContent, "Restore");

  await submit.listener("click")({ preventDefault() {} });
  assert.equal(state.value, "active");
  assert.equal(submit.textContent, "Archive");
  assert.equal(result.textContent, "Review lifecycle restored.");
  assert.equal(error.hidden, true);
  assert.deepEqual(confirmations.at(-1), 'Restore Review "Review lifecycle"?');
  assert.deepEqual(destinations, []);

  state.value = "archived";
  await assert.rejects(
    async () => state.listener("change")({}),
    /Review archival response was invalid/,
  );
});
