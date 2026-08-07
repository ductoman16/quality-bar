import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("Evaluations surfaces the exact exhausted error and retries the same identity", async () => {
  const controls = evaluationElements();
  /** @type {{options: any, path: string}[]} */
  const requests = [];
  const exhausted = evaluation({
    completed_at: null,
    effective_outcome: "pending",
    exhausted_at: "2026-07-30T12:00:00.000Z",
    execution_status: "queued",
    id: "evaluation-retry",
    pre_start_attempt_count: 3,
    retry_error: {
      code: "repository_permission_denied",
      detail: "Repository permission denied",
    },
    retry_state: "exhausted",
  });
  const context = {
    crypto: { randomUUID: () => "retry-idempotency-key" },
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
            return { items: [exhausted], next_cursor: null };
          },
        };
      }
      if (path === "/api/v1/evaluations/evaluation-retry/retry") {
        return {
          ok: true,
          async json() {
            return {
              ...exhausted,
              exhausted_at: null,
              retry_state: "ready",
            };
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      location: { search: "" },
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
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
    ["src/browser/waiver-batch.js", "/assets/waiver-batch.js"],
    ["src/browser/evaluation-result.js", "/assets/evaluation-result.js"],
    ["src/browser/evaluation-feedback.js", "/assets/evaluation-feedback.js"],
    [
      "src/browser/evaluation-active-controls.js",
      "/assets/evaluation-active-controls.js",
    ],
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
    /retry exhausted.*repository_permission_denied: Repository permission denied/,
  );
  const retry = row.options.find(
    (/** @type {any} */ element) =>
      element.textContent === "Retry evaluation-retry",
  );
  assert.ok(retry);
  await retry.listener("click")();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(requests.find(({ path }) => path.endsWith("/retry"))),
    ),
    {
      options: {
        headers: {
          "idempotency-key": "retry-idempotency-key",
          "x-quality-bar-csrf": "csrf-token",
        },
        method: "POST",
      },
      path: "/api/v1/evaluations/evaluation-retry/retry",
    },
  );
});
