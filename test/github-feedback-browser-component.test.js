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
  const controls = evaluationElements();
  const browserContext = {
    crypto: { randomUUID: () => "idempotency-key" },
    document: { createElement: () => browserElement() },
    async fetch(/** @type {string} */ path) {
      if (path === "/api/v1/evaluations") {
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
    "src/browser/evaluation.js",
    readBrowserAsset("/assets/evaluation.js"),
    browserContext,
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const row = controls.get("evaluation-attention").options[0];
  const states = row.options.slice(1);
  assert.equal(controls.get("evaluation-recent").options.length, 0);
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
          'Aggregate feedback — succeeded — Source source-1 — Target {"repository_id":101} — Attempts 1 — Last attempt 2026-07-28T12:00:00.000Z — GitHub comment 701 — Published 2026-07-29T12:00:00.000Z',
      },
      {
        ariaLive: "polite",
        role: "status",
        textContent:
          'Finding finding-inline inline feedback — succeeded — Source finding-inline — Target {"repository_id":101} — Attempts 1 — Last attempt 2026-07-28T12:00:00.000Z — GitHub comment 702 — Published 2026-07-29T12:00:00.000Z',
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
          'Finding finding-failed inline feedback — waiting — Source finding-failed — Target {"repository_id":101} — Attempts 2 — Last attempt 2026-07-28T12:00:00.000Z — Reconciliation required — Provider gate until 2026-07-29T12:01:00.000Z — Next attempt 2026-07-29T12:01:00.000Z — Error github_api_transient_failure: GitHub API request temporarily failed with HTTP 429',
      },
    ],
  );
});
