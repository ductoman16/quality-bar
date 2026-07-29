import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("the operator cancels active work and reads one complete cancelled Result", async () => {
  const controls = evaluationElements();
  /** @type {Array<{options: any, path: string}>} */
  const requests = [];
  let cancelled = false;
  const context = {
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path, /** @type {any} */ options) {
      requests.push({ options, path });
      if (path === "/api/v1/evaluations") {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  completed_at: cancelled ? "2026-07-28T12:00:00.000Z" : null,
                  effective_outcome: cancelled ? "error" : "pending",
                  execution_status: cancelled ? "cancelled" : "running",
                  id: "evaluation-cancelled",
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (
        path === "/api/v1/evaluations/evaluation-cancelled/cancel" &&
        options?.method === "POST"
      ) {
        cancelled = true;
        return {
          ok: true,
          async json() {
            return evaluation({
              effective_outcome: "error",
              execution_status: "cancelled",
              id: "evaluation-cancelled",
            });
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-cancelled/result") {
        return {
          ok: true,
          async json() {
            return {
              applicability_results: [],
              completed_at: "2026-07-28T12:00:00.000Z",
              criterion_results: [],
              evaluation_id: "evaluation-cancelled",
              file_changes: [],
              findings: [],
              outcome: "error",
              review_runs: [
                {
                  completed_at: "2026-07-28T12:00:00.000Z",
                  error: {
                    code: "cancelled_by_operator",
                    detail: "Evaluation was cancelled by the operator",
                  },
                  id: "review-run-cancelled-before-start",
                  review_id: "review-cancelled",
                  review_version_id: "review-version-cancelled",
                  started_at: null,
                  execution_status: "cancelled",
                },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      location: { search: "?view=evaluations" },
      qualityBarOperator: {
        csrfToken: () => "browser-csrf-owned-secret",
        async displayMutationFailure() {},
        async readRepositoryCollection() {
          return { failure: null, items: [] };
        },
        requiredElement(/** @type {string} */ id) {
          return controls.get(id);
        },
      },
    },
  };
  for (const [sourcePath, route] of [
    ["src/browser/evaluation-result.js", "/assets/evaluation-result.js"],
    ["src/browser/evaluation.js", "/assets/evaluation.js"],
  ]) {
    executeServedBrowserAsset(
      resolve("."),
      sourcePath,
      readBrowserAsset(route),
      context,
    );
  }
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const activeRow = controls.get("evaluation-active").options[0];
  assert.equal(activeRow.options[1].textContent, "Cancel evaluation-cancelled");
  await activeRow.options[1].listener("click")();
  assert.ok(
    requests.some(
      ({ options, path }) =>
        path === "/api/v1/evaluations/evaluation-cancelled/cancel" &&
        options.method === "POST" &&
        options.headers["x-quality-bar-csrf"] === "browser-csrf-owned-secret",
    ),
  );
  const cancelledResult = controls.get("evaluation-attention").options[0]
    .options[0];
  assert.equal(cancelledResult.textContent, "Result error");
  assert.equal(
    cancelledResult.options[0].options[0].textContent,
    "Review review-cancelled review-version-cancelled — cancelled",
  );
  assert.equal(
    cancelledResult.options[0].options[1].textContent,
    "Error cancelled_by_operator: Evaluation was cancelled by the operator",
  );
});

test("superseded pull-request work exposes its exact cancellation state", async () => {
  const controls = evaluationElements();
  const context = {
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path) {
      if (path === "/api/v1/evaluations") {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  completed_at: "2026-07-29T12:00:00.000Z",
                  effective_outcome: "error",
                  execution_status: "cancelled",
                  id: "evaluation-superseded",
                  provenance: "automatic",
                  pull_request: { number: 17 },
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-superseded/result") {
        return {
          ok: true,
          async json() {
            return {
              applicability_results: [],
              completed_at: "2026-07-29T12:00:00.000Z",
              criterion_results: [],
              evaluation_id: "evaluation-superseded",
              file_changes: [],
              findings: [],
              outcome: "error",
              review_runs: [
                {
                  completed_at: "2026-07-29T12:00:00.000Z",
                  error: {
                    code: "cancelled_by_supersession",
                    detail:
                      "Evaluation was superseded by a different pull request Changeset",
                  },
                  execution_status: "cancelled",
                  id: "review-run-superseded",
                  review_id: "review-1",
                  review_version_id: "review-version-1",
                  started_at: null,
                },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      location: { search: "?view=evaluations" },
      qualityBarOperator: {
        csrfToken: () => "browser-csrf-owned-secret",
        async displayMutationFailure() {},
        async readRepositoryCollection() {
          return { failure: null, items: [] };
        },
        requiredElement(/** @type {string} */ id) {
          return controls.get(id);
        },
      },
    },
  };
  for (const [sourcePath, route] of [
    ["src/browser/evaluation-result.js", "/assets/evaluation-result.js"],
    ["src/browser/evaluation.js", "/assets/evaluation.js"],
  ]) {
    executeServedBrowserAsset(
      resolve("."),
      sourcePath,
      readBrowserAsset(route),
      context,
    );
  }
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const row = controls.get("evaluation-attention").options[0];
  assert.match(
    row.textContent,
    /automatic pull request #17 .* cancelled — error/,
  );
  assert.equal(row.options.length, 1);
  assert.equal(row.options[0].textContent, "Result error");
  assert.equal(
    row.options[0].options[0].options[1].textContent,
    "Error cancelled_by_supersession: Evaluation was superseded by a different pull request Changeset",
  );
});

test("each explicit browser rerun of one Changeset owns a fresh key", async () => {
  const controls = evaluationElements();
  controls.get("evaluation-repository").value = "repository-1";
  controls.get("evaluation-base-type").value = "branch";
  controls.get("evaluation-base-value").value = "main";
  controls.get("evaluation-head-type").value = "branch";
  controls.get("evaluation-head-value").value = "topic";
  /** @type {Array<{options: any, path: string}>} */
  const requests = [];
  let key = 0;
  const context = {
    crypto: {
      randomUUID: () => `intentional-rerun-key-${++key}`,
    },
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path, /** @type {any} */ options) {
      requests.push({ options, path });
      if (path === "/api/v1/evaluations") {
        return {
          ok: true,
          async json() {
            return { items: [], next_cursor: null };
          },
        };
      }
      if (path === "/api/v1/repositories/repository-1/evaluations") {
        return {
          ok: true,
          async json() {
            return { id: `evaluation-${key}` };
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      location: { search: "" },
      qualityBarEvaluationResult: {
        async render() {
          throw new Error("an empty collection must not render a Result");
        },
      },
      qualityBarOperator: {
        csrfToken: () => "csrf-owned-secret",
        async displayMutationFailure() {
          throw new Error("successful reruns must not display a failure");
        },
        async readRepositoryCollection() {
          return {
            failure: null,
            items: [
              {
                id: "repository-1",
                url: "https://example.invalid/repository.git",
              },
            ],
          };
        },
        requiredElement(/** @type {string} */ id) {
          const element = controls.get(id);
          assert.ok(element);
          return element;
        },
      },
    },
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    context,
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  for (let index = 0; index < 2; index += 1) {
    await controls.get("evaluation-create-form").listener("submit")({
      preventDefault() {},
    });
  }
  assert.deepEqual(
    requests
      .filter(({ path }) => path.endsWith("/repository-1/evaluations"))
      .map(({ options }) => ({
        body: JSON.parse(options.body),
        key: options.headers["idempotency-key"],
      })),
    [
      {
        body: {
          base: { type: "branch", value: "main" },
          head: { type: "branch", value: "topic" },
        },
        key: "intentional-rerun-key-1",
      },
      {
        body: {
          base: { type: "branch", value: "main" },
          head: { type: "branch", value: "topic" },
        },
        key: "intentional-rerun-key-2",
      },
    ],
  );
  assert.equal(
    controls.get("evaluation-create-status").textContent,
    "Evaluation evaluation-2 completed.",
  );
});
