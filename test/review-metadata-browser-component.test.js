import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  browserElement,
  failureResponse,
  reviewResource,
} from "./review-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("a Review metadata validation error preserves local values and focuses its control", async () => {
  /** @type {string | undefined} */
  let focusedControl;
  const form = browserElement({ hidden: true });
  const name = browserElement();
  name.focus = () => {
    focusedControl = "name";
  };
  const description = browserElement();
  description.focus = () => {
    focusedControl = "description";
  };
  const error = browserElement({ hidden: true });
  const nameError = browserElement({ hidden: true });
  const descriptionError = browserElement({ hidden: true });
  const result = browserElement({ textContent: "stale success" });
  const selector = browserElement();
  const submit = browserElement();
  /** @type {Map<string, ReturnType<typeof browserElement>>} */
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
    ["review-metadata-form", form],
    ["review-metadata-review", selector],
    ["review-metadata-id", browserElement()],
    ["review-metadata-name", name],
    ["review-metadata-name-error", nameError],
    ["review-metadata-description", description],
    ["review-metadata-description-error", descriptionError],
    ["review-metadata-result", result],
    ["review-metadata-submit", submit],
  ]);
  /** @type {Map<string, (event: any) => unknown>} */
  const documentListeners = new Map();
  /** @type {{type: string, detail: unknown}[]} */
  const dispatchedEvents = [];
  /** @type {{path: string, options: object}[]} */
  const requests = [];
  /** @type {string[]} */
  const destinations = [];
  let browserCookie = "quality_bar_configured_csrf=csrf-token";
  let metadataAttempt = 0;
  let listAttempt = 0;
  /** @type {(() => void) | undefined} */
  let resolvePendingResponse;
  /** @type {(() => void) | undefined} */
  let resolvePendingFailure;
  /** @type {(() => void) | undefined} */
  let rejectPendingTransport;

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/review-metadata.js",
    readBrowserAsset("/assets/review-metadata.js"),
    {
      CustomEvent,
      document: {
        /** @param {string} eventName @param {(event: any) => unknown} listener */
        addEventListener(eventName, listener) {
          documentListeners.set(eventName, listener);
        },
        /** @param {{type: string, detail: unknown}} event */
        dispatchEvent(event) {
          dispatchedEvents.push({ detail: event.detail, type: event.type });
          return true;
        },
        get cookie() {
          return browserCookie;
        },
        /** @param {string} id */
        getElementById(id) {
          return elements.get(id) ?? null;
        },
        /** @param {string} tagName */
        createElement(tagName) {
          assert.ok(["a", "option"].includes(tagName));
          return browserElement({ href: "" });
        },
      },
      /** @param {string} path @param {object} options */
      async fetch(path, options) {
        requests.push({ options, path });
        if (path === "/api/v1/reviews") {
          listAttempt += 1;
          if (listAttempt === 2) {
            return failureResponse(
              "storage_unavailable",
              "Review storage is unavailable",
              503,
            );
          }
          if (listAttempt === 3) {
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
                reviews: [
                  reviewResource({
                    description: "Persisted description.",
                    id: "persisted-review",
                    name: "Persisted name",
                  }),
                  reviewResource({
                    description: "Second description.",
                    id: "second-review",
                    name: "Second name",
                  }),
                ],
              };
            },
          };
        }
        metadataAttempt += 1;
        if (metadataAttempt === 3) {
          return {
            ok: true,
            status: 200,
            async json() {
              return reviewResource({
                description: "Locally edited description.",
                id: "review/lineage",
                name: "Saved lineage",
              });
            },
          };
        }
        if (metadataAttempt === 4) {
          return failureResponse(
            "authentication_required",
            "Authentication is required",
            401,
          );
        }
        if (metadataAttempt === 5) {
          throw new TypeError("network failed");
        }
        if (metadataAttempt === 6) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                description: "Partial description.",
                id: "review/lineage",
                name: "Partial Review",
              };
            },
          };
        }
        if (metadataAttempt === 7) {
          return new Promise((resolve) => {
            resolvePendingResponse = () =>
              resolve({
                ok: true,
                status: 200,
                async json() {
                  return reviewResource({
                    description: "Pending description.",
                    id: "review/lineage",
                    name: "Pending Review",
                  });
                },
              });
          });
        }
        if (metadataAttempt === 8) {
          return new Promise((resolve) => {
            resolvePendingFailure = () =>
              resolve({
                ok: false,
                status: 422,
                async json() {
                  return {
                    error: {
                      code: "review_name_invalid",
                      message: "Review name must be nonblank",
                    },
                  };
                },
              });
          });
        }
        if (metadataAttempt === 9) {
          return {
            ok: true,
            status: 200,
            async json() {
              return reviewResource({
                description: "Wrong Review description.",
                id: "wrong-review",
                name: "Wrong Review",
              });
            },
          };
        }
        if (metadataAttempt === 10) {
          return new Promise((resolve, reject) => {
            void resolve;
            rejectPendingTransport = () =>
              reject(new TypeError("late network failure"));
          });
        }
        return {
          ok: false,
          status: 422,
          async json() {
            return {
              error: {
                code:
                  metadataAttempt === 1
                    ? "review_name_invalid"
                    : "review_description_invalid",
                message:
                  metadataAttempt === 1
                    ? "Review name must be nonblank"
                    : "Review description must be nonblank",
              },
            };
          },
        };
      },
      location: {
        /** @param {string} value */
        assign(value) {
          destinations.push(value);
        },
        pathname: "/",
        search: "?view=reviews",
      },
    },
  );

  const systemLoaded = documentListeners.get("quality-bar:system-loaded");
  assert.ok(systemLoaded);
  await systemLoaded(new CustomEvent("quality-bar:system-loaded"));
  assert.equal(form.hidden, false);
  assert.equal(selector.value, "persisted-review");
  assert.equal(selector.children.length, 2);
  assert.equal(name.value, "Persisted name");
  assert.equal(description.value, "Persisted description.");
  selector.value = "second-review";
  selector.listener("change")({});
  assert.equal(name.value, "Second name");
  assert.equal(description.value, "Second description.");

  const reviewCreated = documentListeners.get("quality-bar:review-created");
  assert.ok(reviewCreated);
  assert.throws(
    () => reviewCreated(new CustomEvent("quality-bar:review-created")),
    /review_created_event_invalid/,
  );
  reviewCreated(
    new CustomEvent("quality-bar:review-created", {
      detail: reviewResource({
        description: "Initial description.",
        id: "review/lineage",
        name: "Initial name",
      }),
    }),
  );
  assert.equal(form.hidden, false);
  assert.equal(name.value, "Initial name");
  assert.equal(description.value, "Initial description.");
  name.value = "Locally edited name";
  description.value = "Locally edited description.";
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    {
      path: "/api/v1/reviews",
    },
    {
      options: {
        body: JSON.stringify({
          description: "Locally edited description.",
          name: "Locally edited name",
        }),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "PATCH",
      },
      path: "/api/v1/reviews/review%2Flineage/metadata",
    },
  ]);
  assert.equal(name.value, "Locally edited name");
  assert.equal(description.value, "Locally edited description.");
  assert.equal(result.textContent, "");
  assert.equal(
    /** @type {{textContent?: unknown}} */ (error.children[0]).textContent,
    "Review name must be nonblank",
  );
  assert.equal(error.hidden, false);
  assert.equal(nameError.textContent, "Review name must be nonblank");
  assert.equal(nameError.hidden, false);
  assert.equal(
    /** @type {{href?: unknown}} */ (error.children[0]).href,
    "#review-metadata-name",
  );
  assert.equal(focusedControl, "name");

  browserCookie = "";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "browser_csrf_unavailable");
  browserCookie = "quality_bar_configured_csrf=csrf-token";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(
    /** @type {{textContent?: unknown}} */ (error.children[0]).textContent,
    "Review description must be nonblank",
  );
  assert.equal(nameError.hidden, true);
  assert.equal(
    descriptionError.textContent,
    "Review description must be nonblank",
  );
  assert.equal(descriptionError.hidden, false);
  assert.equal(focusedControl, "description");
  assert.equal(name.value, "Locally edited name");
  assert.equal(description.value, "Locally edited description.");

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(result.textContent, "Saved lineage metadata saved.");
  assert.deepEqual(
    dispatchedEvents.map((event) => event.type),
    ["quality-bar:review-updated"],
  );
  const updatedDetail = /** @type {{review: {id: string}}} */ (
    dispatchedEvents[0].detail
  );
  assert.equal(updatedDetail.review.id, "review/lineage");

  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(destinations, ["/?return_to=%2F%3Fview%3Dreviews"]);

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "network failed");
  assert.equal(error.hidden, false);
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Review metadata response was invalid");

  const requestCountBeforePending = requests.length;
  const pendingSave = form.listener("submit")({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(submit.disabled, true);
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(requests.length, requestCountBeforePending + 1);
  selector.value = "second-review";
  selector.listener("change")({});
  name.value = "Unsaved second name";
  description.value = "Unsaved second description.";
  assert.ok(resolvePendingResponse);
  resolvePendingResponse();
  await pendingSave;
  assert.equal(submit.disabled, false);
  assert.equal(selector.value, "second-review");
  assert.equal(name.value, "Unsaved second name");
  assert.equal(description.value, "Unsaved second description.");
  assert.equal(result.textContent, "");

  selector.value = "review/lineage";
  selector.listener("change")({});
  name.value = "Rejected old name";
  description.value = "Rejected old description.";
  focusedControl = undefined;
  const pendingFailure = form.listener("submit")({ preventDefault() {} });
  await Promise.resolve();
  selector.value = "second-review";
  selector.listener("change")({});
  name.value = "Current second name";
  description.value = "Current second description.";
  assert.ok(resolvePendingFailure);
  resolvePendingFailure();
  await pendingFailure;
  assert.equal(
    error.textContent,
    "Review review/lineage: Review name must be nonblank",
  );
  assert.equal(error.hidden, false);
  assert.equal(nameError.hidden, true);
  assert.equal(descriptionError.hidden, true);
  assert.equal(focusedControl, undefined);
  assert.equal(selector.value, "second-review");
  assert.equal(name.value, "Current second name");
  assert.equal(description.value, "Current second description.");

  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Review metadata response was invalid");
  assert.equal(selector.value, "second-review");
  assert.equal(name.value, "Current second name");
  assert.equal(description.value, "Current second description.");

  focusedControl = undefined;
  const pendingTransport = form.listener("submit")({ preventDefault() {} });
  await Promise.resolve();
  selector.value = "review/lineage";
  selector.listener("change")({});
  name.value = "Current first name";
  description.value = "Current first description.";
  assert.ok(rejectPendingTransport);
  rejectPendingTransport();
  await pendingTransport;
  assert.equal(error.textContent, "Review second-review: late network failure");
  assert.equal(focusedControl, undefined);
  assert.equal(name.value, "Current first name");
  assert.equal(description.value, "Current first description.");

  await systemLoaded(new CustomEvent("quality-bar:system-loaded"));
  assert.equal(error.textContent, "Review storage is unavailable");
  await systemLoaded(new CustomEvent("quality-bar:system-loaded"));
  assert.equal(error.textContent, "Review metadata response was invalid");
});
