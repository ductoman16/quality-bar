import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  reviewResource,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {[string, ReturnType<typeof browserElement>][]} [overrides] */
function elements(overrides = []) {
  const values = new Map();
  for (const id of [
    "error",
    "review-archival-review",
    "review-archival-result",
    "review-delete",
    "review-delete-confirmation",
    "review-delete-confirmation-form",
    "review-delete-confirmation-input",
    "review-delete-confirmation-message",
    "review-delete-confirmation-cancel",
  ]) {
    values.set(id, browserElement());
  }
  for (const [id, value] of overrides) {
    values.set(id, value);
  }
  return values;
}

test("Review deletion requires the exact lineage name and observes canonical removal", async () => {
  const error = browserElement({ hidden: true });
  const result = browserElement();
  const controls = elements([
    ["error", error],
    ["review-archival-result", result],
  ]);
  const review = reviewResource({
    description: "Delete only this never-used lineage.",
    id: "review/unused",
    name: "Never used Review",
  });
  /** @type {ReturnType<typeof reviewResource> | undefined} */
  let current = review;
  /** @type {Array<{path: string, options: object}>} */
  const requests = [];
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-delete.js",
    readBrowserAsset("/assets/review-delete.js"),
    {
      document: {
        qualityBarReviewVersionContract: {
          csrfToken: () => "csrf-token",
          async readFailure() {
            throw new Error("unexpected deletion failure response");
          },
          /** @param {string} id */
          requiredElement: (id) => controls.get(id),
        },
      },
      /** @param {string} path @param {object} options */
      async fetch(path, options) {
        requests.push({ options, path });
        current = undefined;
        return { ok: true };
      },
      window: {
        qualityBarReviewLifecycle: {
          find: () => current,
          ready: async () => true,
          refresh: async () => true,
          syncDeleteAvailability() {},
        },
      },
    },
  );
  controls.get("review-archival-review").value = review.id;
  await controls.get("review-delete").listener("click")({});
  assert.equal(controls.get("review-delete-confirmation").open, true);
  assert.equal(
    controls.get("review-delete-confirmation-message").textContent,
    'Delete Review "Never used Review" permanently. This cannot be undone.',
  );

  controls.get("review-delete-confirmation-input").value = "wrong";
  await controls.get("review-delete-confirmation-form").listener("submit")({
    preventDefault() {},
  });
  assert.equal(
    error.textContent,
    "Type the Review name to confirm permanent deletion",
  );
  assert.equal(requests.length, 0);

  controls.get("review-delete-confirmation-input").value = review.name;
  await controls.get("review-delete-confirmation-form").listener("submit")({
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      options: {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "DELETE",
      },
      path: "/api/v1/reviews/review%2Funused",
    },
  ]);
  assert.equal(result.textContent, "Never used Review deleted.");
  assert.equal(result.focused, true);
  assert.equal(error.hidden, true);
});

test("Review deletion never infers success when the response is lost", async () => {
  const error = browserElement({ hidden: true });
  const result = browserElement();
  const controls = elements([
    ["error", error],
    ["review-archival-result", result],
  ]);
  const review = reviewResource({
    description: "Keep a lost response exact.",
    id: "review-lost",
    name: "Lost response Review",
  });
  /** @type {ReturnType<typeof reviewResource> | undefined} */
  let current = review;
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-delete.js",
    readBrowserAsset("/assets/review-delete.js"),
    {
      document: {
        qualityBarReviewVersionContract: {
          csrfToken: () => "csrf-token",
          async readFailure() {
            throw new Error("unexpected deletion failure response");
          },
          /** @param {string} id */
          requiredElement: (id) => controls.get(id),
        },
      },
      async fetch() {
        current = undefined;
        throw new TypeError("response lost");
      },
      window: {
        qualityBarReviewLifecycle: {
          find: () => current,
          ready: async () => true,
          refresh: async () => {
            throw new Error("Review listing failed");
          },
          syncDeleteAvailability() {},
        },
      },
    },
  );
  controls.get("review-archival-review").value = review.id;
  await controls.get("review-delete").listener("click")({});
  controls.get("review-delete-confirmation-input").value = review.name;
  await controls.get("review-delete-confirmation-form").listener("submit")({
    preventDefault() {},
  });

  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Review deletion failed");
  assert.equal(error.focused, true);
  assert.equal(result.textContent, "");
  assert.equal(result.focused, false);
});

test("Review deletion surfaces the exact canonical refresh failure after a success response", async () => {
  const error = browserElement({ hidden: true });
  const controls = elements([["error", error]]);
  const review = reviewResource({
    description: "Keep refresh failure exact.",
    id: "review-refresh-failed",
    name: "Refresh failure Review",
  });
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-delete.js",
    readBrowserAsset("/assets/review-delete.js"),
    {
      document: {
        qualityBarReviewVersionContract: {
          csrfToken: () => "csrf-token",
          async readFailure() {
            throw new Error("unexpected deletion failure response");
          },
          /** @param {string} id */
          requiredElement: (id) => controls.get(id),
        },
      },
      async fetch() {
        return { ok: true };
      },
      window: {
        qualityBarReviewLifecycle: {
          find: () => review,
          ready: async () => true,
          refresh: async () => {
            throw new Error("Review listing failed");
          },
          syncDeleteAvailability() {},
        },
      },
    },
  );
  controls.get("review-archival-review").value = review.id;
  await controls.get("review-delete").listener("click")({});
  controls.get("review-delete-confirmation-input").value = review.name;
  await controls.get("review-delete-confirmation-form").listener("submit")({
    preventDefault() {},
  });

  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Review listing failed");
  assert.equal(error.focused, true);
  assert.equal(controls.get("review-archival-result").textContent, "");
});
