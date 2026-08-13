import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failureResponse,
  FakeCustomEvent,
  reviewVersionBrowserHarness,
} from "./review-browser-component-support.js";

test("the Review authoring surface reactivates a selected immutable version", async () => {
  const {
    activateVersion,
    activationSelector,
    created,
    documentListeners,
    destinations,
    error,
    document,
    queueReactivationResponse,
    requests,
    result,
  } = reviewVersionBrowserHarness();
  /** @type {{review: {id: string}}[]} */
  const reviewUpdatedEvents = [];
  documentListeners.set(
    "quality-bar:review-updated",
    /** @param {{detail: {review: {id: string}}}} event */ (event) => {
      reviewUpdatedEvents.push(event.detail);
    },
  );
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
  const previous = created.active_version;
  const current = {
    ...previous,
    id: "review/one-v2",
    number: 2,
  };
  const reviewCreated = documentListeners.get("quality-bar:review-created");
  assert.ok(reviewCreated);
  reviewCreated(
    new FakeCustomEvent("quality-bar:review-created", {
      detail: {
        ...created,
        active_version: current,
        versions: [previous, current],
      },
    }),
  );

  activationSelector.value = previous.id;
  activationSelector.listener("change")({});
  await activateVersion.listener("click")({});

  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({ review_version_id: previous.id }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
    path: "/api/v1/reviews/review%2Fone/active-version",
  });
  assert.equal(result.textContent, "Executable boundaries v1 active.");
  assert.equal(error.hidden, true);
  assert.equal(reviewUpdatedEvents.at(-1)?.review.id, "review/one");

  activationSelector.value = current.id;
  activationSelector.listener("change")({});
  queueReactivationResponse(
    failureResponse(
      "codex_model_unsupported",
      "Codex model is not supported by the pinned catalog",
      422,
    ),
  );
  await activateVersion.listener("click")({});
  assert.equal(
    error.textContent,
    "Codex model is not supported by the pinned catalog",
  );
  assert.equal(result.textContent, "");

  queueReactivationResponse(
    failureResponse(
      "authentication_required",
      "Authentication is required",
      401,
    ),
  );
  await activateVersion.listener("click")({});
  assert.deepEqual(destinations, ["/?return_to=%2F%3Fview%3Dreviews"]);

  assert.throws(
    () =>
      document.dispatchEvent(
        new FakeCustomEvent("quality-bar:review-version-mutation", {
          detail: {},
        }),
      ),
    /review_version_mutation_event_invalid/,
  );
  document.dispatchEvent(
    new FakeCustomEvent("quality-bar:review-version-mutation", {
      detail: { pending: true },
    }),
  );
  const requestCount = requests.length;
  await activateVersion.listener("click")({});
  assert.equal(requests.length, requestCount);
  document.dispatchEvent(
    new FakeCustomEvent("quality-bar:review-version-mutation", {
      detail: { pending: false },
    }),
  );

  document.cookie = "";
  await activateVersion.listener("click")({});
  assert.equal(error.textContent, "browser_csrf_unavailable");
});
