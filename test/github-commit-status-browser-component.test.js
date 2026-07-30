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
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    {
      crypto: { randomUUID: () => "idempotency-key" },
      document: { createElement: () => browserElement() },
      /** @param {string} path */
      async fetch(path) {
        if (path === "/api/v1/evaluations") {
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
        throw new Error(`unexpected fetch: ${path}`);
      },
      window: {
        location: { search: "" },
        qualityBarEvaluationFeedback: {
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
    },
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const state = controls.get("evaluation-attention").options[0].options[1];
  assert.equal(controls.get("evaluation-recent").options.length, 0);
  assert.equal(state["aria-live"], "polite");
  assert.equal(state.role, "status");
  assert.equal(
    state.textContent,
    'Commit status — Quality Bar — intended state success — unavailable — Source source-1 — Target {"repository_id":101} — Attempts 1 — Last attempt 2026-07-28T12:00:00.000Z — Error github_api_request_failed: GitHub API request failed with HTTP 403',
  );
});
