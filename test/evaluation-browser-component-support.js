import assert from "node:assert/strict";

import { browserElement } from "./repository-browser-component-support.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);

/** @param {string} page */
export function assertEvaluationPage(page) {
  for (const pattern of [
    /<h1>Evaluations<\/h1>/,
    /id="evaluation-create-form"/,
    /id="evaluation-active"/,
    /id="evaluation-recent"/,
    /id="evaluation-attention"/,
    /id="evaluation-more"/,
    /<script src="\/assets\/evaluation-result\.js"><\/script>/,
    /<script src="\/assets\/evaluation-feedback\.js"><\/script>/,
    /<script src="\/assets\/evaluation\.js"><\/script>/,
  ]) {
    assert.match(page, pattern);
  }
}

const delivery = {
  attempt_count: 1,
  last_attempt_at: "2026-07-28T12:00:00.000Z",
  next_attempt_at: null,
  provider_gate_until: null,
  reconciliation_required: false,
  source_identity: "source-1",
  target: '{"repository_id":101}',
};

/** @param {Record<string, any>} [overrides] */
export const evaluation = (overrides = {}) => {
  const value = /** @type {any} */ ({
    base_commit: oid("1"),
    base_selector: { type: "branch", value: "main" },
    completed_at: "2026-07-28T12:00:00.000Z",
    created_at: "2026-07-28T12:00:00.000Z",
    effective_outcome: "clear",
    execution_status: "completed",
    head_commit: oid("2"),
    head_selector: { type: "branch", value: "topic" },
    id: "evaluation-complete",
    next_attempt_at: null,
    provenance: "explicit",
    repository: {
      id: "repository-1",
      url: "https://example.invalid/repository.git",
    },
    ...overrides,
  });
  if (value.commit_status) {
    value.commit_status = {
      ...delivery,
      external_id: null,
      ...value.commit_status,
    };
  }
  if (value.feedback) {
    value.feedback = {
      aggregate: { ...delivery, ...value.feedback.aggregate },
      findings: value.feedback.findings.map((/** @type {any} */ finding) => ({
        ...(finding.publication_status === "aggregate_only"
          ? {
              ...delivery,
              attempt_count: 0,
              last_attempt_at: null,
              target: "aggregate_only",
            }
          : delivery),
        source_identity: finding.finding_id,
        ...finding,
      })),
    };
  }
  return value;
};

export function evaluationElements() {
  return /** @type {any} */ (
    new Map(
      [
        "evaluation-create-form",
        "evaluation-repository",
        "evaluation-base-type",
        "evaluation-base-value",
        "evaluation-head-type",
        "evaluation-head-value",
        "evaluation-loading",
        "evaluation-empty",
        "evaluation-state",
        "evaluation-active",
        "evaluation-recent",
        "evaluation-attention",
        "evaluation-more",
        "evaluation-create-status",
      ].map((id) => [id, browserElement({ hidden: true })]),
    )
  );
}

/** @param {string} path */
export function reviewRunDiagnosticsResponse(path) {
  return {
    ok: true,
    async json() {
      return {
        codex_cli_version: "0.145.0",
        completed_at: "2026-07-28T12:00:01.000Z",
        duration_ms: 1_000,
        process: { code: 0, kind: "exit" },
        review_run_id: path.split("/").at(-2),
        started_at: "2026-07-28T12:00:00.000Z",
        token_counters: {
          cached_input_tokens: null,
          input_tokens: null,
          output_tokens: null,
        },
        transcript_chunks: [],
      };
    },
  };
}
