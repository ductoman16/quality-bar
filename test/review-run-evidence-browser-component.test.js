import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { browserElement } from "./repository-browser-component-support.js";

test("the operator browser renders raw Review Run diagnostics without configuration attestation", async () => {
  const target = browserElement();
  const context = /** @type {any} */ ({
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path) {
      assert.equal(
        path,
        "/api/v1/evaluations/evaluation-1/review-runs/review-run-1/diagnostics",
      );
      return {
        ok: true,
        async json() {
          return {
            codex_cli_version: "0.145.0",
            completed_at: "2026-07-28T12:00:00.000Z",
            duration_ms: 60_000,
            process: { kind: "signal", signal: "SIGTERM" },
            review_run_id: "review-run-1",
            started_at: "2026-07-28T11:59:00.000Z",
            token_counters: {
              cached_input_tokens: 45,
              input_tokens: 120,
              output_tokens: 30,
            },
            transcript_chunks: [
              {
                content: '{"type":"turn.completed"}\n',
                sequence: 1,
                stream: "stdout",
              },
              {
                content: "pinned diagnostic\n",
                sequence: 2,
                stream: "stderr",
              },
            ],
          };
        },
      };
    },
    window: {},
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-result.js",
    readBrowserAsset("/assets/evaluation-result.js"),
    context,
  );
  await context.window.qualityBarEvaluationResult.render(
    target,
    { id: "evaluation-1" },
    {
      applicability_results: [],
      criterion_results: [],
      file_changes: [],
      findings: [],
      outcome: "clear",
      review_runs: [
        {
          id: "review-run-1",
          review_id: "review-1",
          review_version_id: "review-version-1",
          status: "completed",
        },
      ],
    },
    "",
  );

  const diagnostics = target.options[0];
  assert.equal(
    diagnostics.options[0].textContent,
    "Review review-1 review-version-1 — diagnostics",
  );
  assert.equal(
    diagnostics.options[1].textContent,
    "Codex CLI 0.145.0 — 60000 ms — input 120, cached input 45, output 30 — signal SIGTERM",
  );
  assert.equal(diagnostics.options[2].options[0].textContent, "Stdout");
  assert.equal(
    diagnostics.options[2].options[1].textContent,
    '{"type":"turn.completed"}\n',
  );
  assert.equal(diagnostics.options[3].options[0].textContent, "Stderr");
  assert.equal(
    diagnostics.options[3].options[1].textContent,
    "pinned diagnostic\n",
  );
  assert.doesNotMatch(target.textContent, /effective|attest|configuration/i);
});

test("historical CLI evidence is explicitly unavailable and diagnostics failures stay hard", async () => {
  const target = browserElement();
  let unavailable = false;
  const context = /** @type {any} */ ({
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch() {
      if (unavailable) {
        return {
          ok: false,
          async json() {
            return { error: { message: "Diagnostics storage unavailable" } };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            codex_cli_version: null,
            completed_at: "2026-07-28T12:00:00.000Z",
            duration_ms: 1,
            process: { kind: "unavailable" },
            review_run_id: "review-run-1",
            started_at: "2026-07-28T11:59:59.999Z",
            token_counters: {
              cached_input_tokens: null,
              input_tokens: null,
              output_tokens: null,
            },
            transcript_chunks: [],
          };
        },
      };
    },
    window: {},
  });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-result.js",
    readBrowserAsset("/assets/evaluation-result.js"),
    context,
  );
  const evaluation = { id: "evaluation-1" };
  const result = {
    applicability_results: [],
    criterion_results: [],
    file_changes: [],
    findings: [],
    outcome: "clear",
    review_runs: [
      {
        id: "review-run-1",
        review_id: "review-1",
        review_version_id: "review-version-1",
        status: "completed",
      },
    ],
  };
  await context.window.qualityBarEvaluationResult.render(
    target,
    evaluation,
    result,
    "",
  );
  assert.match(target.options[0].options[1].textContent, /CLI unavailable/);
  unavailable = true;
  await assert.rejects(
    () =>
      context.window.qualityBarEvaluationResult.render(
        browserElement(),
        evaluation,
        result,
        "",
      ),
    /Diagnostics storage unavailable/,
  );
});
