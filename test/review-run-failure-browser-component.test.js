import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { browserElement } from "./repository-browser-component-support.js";

test("the operator browser surfaces an exact Codex authentication failure without partial work", async () => {
  const target = browserElement();
  const context = /** @type {any} */ ({
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            codex_cli_version: "0.145.0",
            completed_at: "2026-07-28T12:00:01.000Z",
            duration_ms: 1_000,
            process: { code: 1, kind: "exit" },
            review_run_id: "review-run-authentication",
            started_at: "2026-07-28T12:00:00.000Z",
            token_counters: {
              cached_input_tokens: null,
              input_tokens: null,
              output_tokens: null,
            },
            transcript_chunks: [
              {
                content:
                  '{"type":"turn.failed","error":{"message":"You must be logged in to use Codex. Run codex login."}}\n',
                sequence: 1,
                stream: "stdout",
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
    { id: "evaluation-authentication" },
    {
      applicability_results: [],
      criterion_results: [],
      file_changes: [],
      findings: [],
      outcome: "error",
      review_runs: [
        {
          error: {
            code: "authentication_failed",
            detail: "You must be logged in to use Codex. Run codex login.",
          },
          id: "review-run-authentication",
          review_id: "review-1",
          review_version_id: "review-version-1",
          status: "failed",
        },
      ],
    },
    "",
  );

  assert.equal(
    target.options[0].options[1].textContent,
    "Error authentication_failed: You must be logged in to use Codex. Run codex login.",
  );
  assert.match(
    target.options[1].options[2].options[1].textContent,
    /turn\.failed/,
  );
  assert.equal(target.options.length, 2);
});
