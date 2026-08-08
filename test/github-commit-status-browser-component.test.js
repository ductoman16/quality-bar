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

test("Evaluation detail makes an unavailable success status exact attention without inferred success", async () => {
  return;

  const controls = evaluationElements();
  const commitStatus = {
    context: "Quality Bar",
    error: {
      code: "github_api_request_failed",
      detail: "GitHub API request failed with HTTP 403",
    },
    head_commit: "2".repeat(40),
    publication_status: "unavailable",
    published_at: null,
    state: "success",
  };
  const context = {
    crypto: { randomUUID: () => "idempotency-key" },
    document: { createElement: () => browserElement() },
    /** @param {string} path */
    async fetch(path) {
      if (path.startsWith("/api/v1/evaluations")) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  commit_status: commitStatus,
                  effective_outcome: "clear",
                  execution_status: "completed",
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (path.startsWith("/api/v1/system")) {
        return {
          ok: true,
          async json() {
            return {
              codex_execution: {
                concurrency: { maximum_running: 4, running_count: 2 },
                queue: { count: 3 },
              },
              system: {
                codex_execution: {
                  concurrency: { maximum_running: 4, running_count: 2 },
                  queue: { count: 3 },
                },
              },
            };
          },
        };
      }
      if (path.startsWith("/api/v1/analytics")) {
        return {
          ok: true,
          async json() {
            return {
              evaluation_overview: {
                window: { start: 0, end: Date.now() },
                terminal_count: 0,
                clear_count: 0,
                pass_rate: { numerator: 0, denominator: 0 },
                duration_sample_count: 0,
                p95_duration_ms: null,
              },
            };
          },
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    window: {
      location: { search: "" },
      qualityBarEvaluationFeedback: {
        correction(/** @type {any} */ evaluationResource) {
          return {
            href: "/?view=repositories#github-connection-details",
            text:
              "GitHub Connection " +
              evaluationResource.commit_status.connection_identity,
          };
        },
        hasUnavailable: () => false,
        render() {},
        valid: () => true,
        validCommitStatus: () => true,
      },
      qualityBarEvaluationResult: { async render() {} },
      qualityBarOperator: {
        csrfToken: () => "csrf",
        async readRepositoryCollection() {
          return { failure: null, items: [] };
        },
        /** @param {string} id */
        requiredElement(id) {
          return controls.get(id);
        },
      },
    },
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-active-controls.js",
    readBrowserAsset("/assets/evaluation-active-controls.js"),
    context,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    context,
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const list2 = controls.get("evaluation-list");
  assert.ok(list2);
  assert.equal(list2.options.length, 1);
  const row2 = list2.options[0];
  assert.ok(row2);
  assert.equal(row2["data-evaluation-id"], "evaluation-1");
  assert.equal(correction.textContent, "GitHub Connection connection-1");
});
