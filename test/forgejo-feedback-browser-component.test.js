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

test("Forgejo feedback retry state identifies its source, schedule, gate, and owning Connection", async () => {
  const controls = evaluationElements();
  const browserContext = {
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
                  feedback: {
                    aggregate: {
                      error: {
                        code: "forgejo_api_unavailable",
                        detail: "Forgejo publication route is unavailable",
                      },
                      attempt_count: 3,
                      external_id: null,
                      next_attempt_at: "2026-07-28T13:00:00.000Z",
                      provider_gate_error: {
                        code: "forgejo_api_rate_limited",
                        detail: "Forgejo rate limit is active",
                      },
                      provider_gate_until: "2026-07-28T13:00:00.000Z",
                      publication_status: "waiting",
                      published_at: null,
                      reconciliation_required: true,
                      source_identity: "evaluation-1",
                      target: '{"pull_request_number":17,"repository_id":101}',
                    },
                    findings: [
                      {
                        error: {
                          code: "forgejo_api_unavailable",
                          detail: "Forgejo inline response was lost",
                        },
                        external_id: null,
                        finding_id: "finding-inline",
                        publication_status: "waiting",
                        published_at: null,
                        reconciliation_required: true,
                        target:
                          '{"body":"Evaluation: evaluation-1; Finding: finding-inline","repository_id":101}',
                      },
                    ],
                  },
                }),
                evaluation({
                  id: "evaluation-definitive",
                  feedback: {
                    aggregate: {
                      error: {
                        code: "forgejo_api_request_failed",
                        detail:
                          "Forgejo publication route failed with HTTP 403",
                      },
                      external_id: null,
                      publication_status: "unavailable",
                      published_at: null,
                    },
                    findings: [],
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

  const row = controls.get("evaluation-attention").options[0];
  assert.match(
    row.options[1].textContent,
    /Forgejo publication route is unavailable/,
  );
  assert.match(row.options[1].textContent, /Source evaluation-1/);
  assert.match(row.options[1].textContent, /Attempts 3/);
  assert.match(row.options[1].textContent, /Reconciliation required/);
  assert.match(row.options[1].textContent, /Provider gate until/);
  assert.match(row.options[1].textContent, /Next attempt/);
  assert.equal(
    row.options.some((/** @type {any} */ candidate) =>
      /Evaluation: evaluation-1; Finding: finding-inline/.test(
        candidate.textContent,
      ),
    ),
    true,
  );
  assert.equal(row.options.length, 3);
  const definitive = controls
    .get("evaluation-attention")
    .options.find((/** @type {any} */ candidate) =>
      candidate.options.some((/** @type {any} */ option) => option.href),
    );
  const correction = definitive.options.find(
    (/** @type {any} */ option) => option.href,
  );
  assert.equal(
    correction.href,
    "/?view=repositories#forgejo-connection-details",
  );
  assert.equal(correction.textContent, "Forgejo Connection connection-1");
});
