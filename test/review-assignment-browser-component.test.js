import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  failureResponse,
  FakeCustomEvent,
  reviewResource,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Review Assignment surface submits one exact mode and clears stale success on failure", async () => {
  const form = browserElement({ hidden: true });
  const reviewSelector = browserElement();
  const scope = browserElement({ value: "installation_wide" });
  const repositorySelector = browserElement();
  Object.defineProperty(repositorySelector, "selectedOptions", {
    get() {
      return repositorySelector.children.filter(
        (option) => /** @type {{selected: boolean}} */ (option).selected,
      );
    },
  });
  Object.defineProperty(repositorySelector, "options", {
    get() {
      return repositorySelector.children;
    },
  });
  const submit = browserElement();
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
    ["review-assignment-form", form],
    ["review-assignment-review", reviewSelector],
    ["review-assignment-scope", scope],
    ["review-assignment-repositories", repositorySelector],
    ["review-assignment-submit", submit],
    ["review-assignment-result", result],
  ]);
  const listeners = new Map();
  const review = reviewResource({
    description: "Keep scope exact.",
    id: "review/one",
    name: "Assignment boundaries",
  });
  const changed = {
    ...review,
    assignment: {
      repository_ids: ["repository-1", "repository-2"],
      scope: "repository_set",
    },
  };
  const reconciled = {
    ...review,
    assignment: { scope: "installation_wide" },
  };
  const responses = [
    {
      ok: true,
      status: 200,
      async json() {
        return { reviews: [review] };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return {
          items: [
            { id: "repository-2", url: "https://example.com/aaa.git" },
            { id: "repository-1", url: "https://example.com/zzz.git" },
          ],
          next_cursor: null,
        };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return { changed: true, review: changed };
      },
    },
    failureResponse(
      "review_assignment_repository_not_found",
      "Review Assignment Repository was not found",
      404,
    ),
    {
      ok: true,
      status: 200,
      async json() {
        return { changed: true };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return { reviews: [reconciled] };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return {
          items: [
            { id: "repository-2", url: "https://example.com/aaa.git" },
            { id: "repository-1", url: "https://example.com/zzz.git" },
          ],
          next_cursor: null,
        };
      },
    },
    {
      ok: true,
      status: 200,
      async json() {
        return { changed: true };
      },
    },
    new Error("reconciliation transport failed"),
    {
      ok: true,
      status: 200,
      async json() {
        return { items: [], next_cursor: null };
      },
    },
  ];
  /** @type {Array<{path: string, options?: object}>} */
  const requests = [];
  /** @type {{type: string, detail: unknown}[]} */
  const dispatchedEvents = [];
  const document = {
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    cookie: "quality_bar_configured_csrf=csrf-token",
    /** @param {string} tagName */
    createElement(tagName) {
      return browserElement({ selected: false, tagName });
    },
    /** @param {{type: string, detail: unknown}} event */
    dispatchEvent(event) {
      dispatchedEvents.push({ detail: event.detail, type: event.type });
      return true;
    },
    /** @param {string} id */
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
  const context = {
    CustomEvent: FakeCustomEvent,
    document,
    /** @param {string} path @param {object} [options] */
    async fetch(path, options) {
      requests.push({ options, path });
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected Review Assignment request");
      }
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    location: {
      assign() {
        throw new Error("unexpected authentication redirect");
      },
      pathname: "/",
      search: "?view=reviews",
    },
    window: {
      qualityBarOperator: {
        async readRepositoryCollection() {
          const response = await context.fetch("/api/v1/repositories");
          if (!response.ok) {
            return { failure: response, items: [] };
          }
          const body = /** @type {{items: unknown[]}} */ (
            await response.json()
          );
          return { failure: null, items: body.items };
        },
      },
    },
  };
  for (const sourcePath of [
    "src/browser/review-version-contract.js",
    "src/browser/review-assignment.js",
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
  assert.equal(reviewSelector.value, review.id);
  assert.equal(repositorySelector.disabled, true);

  scope.value = "repository_set";
  scope.listener("change")({});
  for (const option of repositorySelector.children) {
    /** @type {{selected: boolean}} */ (option).selected = true;
  }
  await form.listener("submit")({ preventDefault() {} });

  assert.deepEqual(JSON.parse(JSON.stringify(requests[2])), {
    options: {
      body: JSON.stringify({
        repository_ids: ["repository-1", "repository-2"],
        scope: "repository_set",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
    path: "/api/v1/reviews/review%2Fone/assignment",
  });
  assert.equal(result.textContent, "Assignment boundaries Assignment changed.");
  assert.equal(error.hidden, true);
  assert.deepEqual(
    dispatchedEvents.map((event) => event.type),
    ["quality-bar:review-updated"],
  );
  const updatedDetail = /** @type {{review: {id: string}}} */ (
    dispatchedEvents[0].detail
  );
  assert.equal(updatedDetail.review.id, "review/one");

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Review Assignment Repository was not found");
  assert.equal(result.textContent, "");

  scope.value = "installation_wide";
  scope.listener("change")({});
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Review Assignment response was invalid");
  assert.equal(result.textContent, "");
  assert.equal(form.hidden, false);
  assert.equal(scope.value, "installation_wide");
  assert.equal(repositorySelector.disabled, true);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Review Assignment refresh failed");
  assert.equal(result.textContent, "");
  assert.equal(form.hidden, true);
  assert.equal(submit.disabled, true);
});
