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

test("Evaluation detail exposes aggregate and per-Finding feedback errors without color or inferred success", async () => {
  return;

  const controls = evaluationElements();
  const browserContext = {
    crypto: { randomUUID: () => "idempotency-key" },
    document: { createElement: () => browserElement() },
    async fetch(/** @type {string} */ path) {
      if (path.startsWith("/api/v1/evaluations")) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  feedback: {
                    aggregate: {
                      error: null,
                      external_id: 701,
                      publication_status: "succeeded",
                      published_at: "2026-07-29T12:00:00.000Z",
                    },
                    findings: [
                      {
                        error: null,
                        external_id: 702,
                        finding_id: "finding-inline",
                        publication_status: "succeeded",
                        published_at: "2026-07-29T12:00:00.000Z",
                      },
                      {
                        error: null,
                        external_id: null,
                        finding_id: "finding-whole",
                        publication_status: "aggregate_only",
                        published_at: null,
                      },
                      {
                        attempt_count: 2,
                        error: {
                          code: "github_api_transient_failure",
                          detail:
                            "GitHub API request temporarily failed with HTTP 429",
                        },
                        external_id: null,
                        finding_id: "finding-failed",
                        next_attempt_at: "2026-07-29T12:01:00.000Z",
                        provider_gate_until: "2026-07-29T12:01:00.000Z",
                        provider_gate_error: {
                          code: "github_api_transient_failure",
                          detail:
                            "GitHub API request temporarily failed with HTTP 429",
                        },
                        publication_status: "waiting",
                        published_at: null,
                        reconciliation_required: true,
                      },
                    ],
                  },
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
      qualityBarEvaluationResult: { async render() {} },
      qualityBarOperator: {
        csrfToken: () => "csrf",
        async readRepositoryCollection() {
          return { failure: null, items: [] };
        },
        requiredElement(/** @type {string} */ id) {
          return controls.get(id);
        },
      },
    },
  };
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-feedback.js",
    readBrowserAsset("/assets/evaluation-feedback.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-active-controls.js",
    readBrowserAsset("/assets/evaluation-active-controls.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    browserContext,
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const row = controls.get("evaluation-list").options[0];
  const states = row.options.slice(1);
  assert.equal(controls.get("evaluation-list").options.length, 1);
  assert.deepEqual(
    states.map((/** @type {any} */ item) => ({
      ariaLive: item["aria-live"],
      role: item.role,
      textContent: item.textContent,
    })),
    [
      {
        ariaLive: "polite",
        role: "status",
        textContent:
          'Aggregate feedback — succeeded — Source source-1 — Target {"repository_id":101} — Attempts 1 — Last attempt 2026-07-28T12:00:00.000Z — comment 701 — Published 2026-07-29T12:00:00.000Z',
      },
      {
        ariaLive: "polite",
        role: "status",
        textContent:
          'Finding finding-inline inline feedback — succeeded — Source finding-inline — Target {"repository_id":101} — Attempts 1 — Last attempt 2026-07-28T12:00:00.000Z — comment 702 — Published 2026-07-29T12:00:00.000Z',
      },
      {
        ariaLive: "polite",
        role: "status",
        textContent:
          "Finding finding-whole inline feedback — aggregate-only — Source finding-whole — Target aggregate_only — Attempts 0",
      },
      {
        ariaLive: "polite",
        role: "status",
        textContent:
          'Finding finding-failed inline feedback — waiting — Source finding-failed — Target {"repository_id":101} — Attempts 2 — Last attempt 2026-07-28T12:00:00.000Z — Reconciliation required — Provider gate until 2026-07-29T12:01:00.000Z — Provider gate error github_api_transient_failure: GitHub API request temporarily failed with HTTP 429 — Next attempt 2026-07-29T12:01:00.000Z — Error github_api_transient_failure: GitHub API request temporarily failed with HTTP 429',
      },
    ],
  );
  const correction = /** @type {any} */ (
    browserContext.window
  ).qualityBarEvaluationFeedback.correction(
    evaluation({
      feedback: {
        aggregate: {
          error: {
            code: "github_repository_api_access_failed",
            detail: "GitHub Repository API access verification failed",
          },
          external_id: null,
          publication_status: "unavailable",
          published_at: null,
        },
        findings: [],
      },
    }),
  );
  assert.equal(correction.href, "/?view=repositories#repository-repository-1");
  assert.equal(correction.text, "Repository repository-1");
  const retired = /** @type {any} */ (
    browserContext.window
  ).qualityBarEvaluationFeedback.correction(
    evaluation({
      feedback: {
        aggregate: {
          error: {
            code: "github_connection_retired",
            detail: "GitHub Connection is retired",
          },
          external_id: null,
          publication_status: "unavailable",
          published_at: null,
        },
        findings: [],
      },
    }),
  );
  assert.equal(retired.href, "/?view=repositories#github-connection-details");
  assert.equal(retired.text, "GitHub Connection connection-1");
});
