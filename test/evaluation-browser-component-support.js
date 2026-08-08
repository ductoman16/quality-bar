import assert from "node:assert/strict";

import { browserElement } from "./repository-browser-component-support.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);

/** @param {string} page */
export function assertEvaluationPage(page) {
  for (const id of [
    "evaluation-monitor",
    "evaluation-stat-workers",
    "evaluation-stat-queue",
    "evaluation-stat-pass-rate",
    "evaluation-stat-p95",
    "evaluation-stat-updated",
    "evaluation-stat-window-24h",
    "evaluation-stat-window-7d",
    "evaluation-filter-form",
    "evaluation-filter-repository",
    "evaluation-filter-status",
    "evaluation-filter-outcome",
    "evaluation-filter-query",
    "evaluation-filter-start",
    "evaluation-filter-end",
    "evaluation-filter-reset",
    "evaluation-create-toggle",
    "evaluation-create-form",
    "evaluation-create-repository",
    "evaluation-create-base-type",
    "evaluation-create-base-value",
    "evaluation-create-head-type",
    "evaluation-create-head-value",
    "evaluation-create-submit",
    "evaluation-create-status",
    "evaluation-list",
    "evaluation-empty",
    "evaluation-loading",
    "evaluation-error",
    "evaluation-new-activity",
    "evaluation-load-more",
  ]) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /<script src="\/assets\/evaluation\.js"><\/script>/);
  assert.doesNotMatch(
    page,
    /evaluation-result\.js|evaluation-feedback\.js|waiver-batch\.js/,
  );
}

/** @param {Record<string, any>} [overrides] */
export const evaluation = (overrides = {}) => ({
  base_commit: oid("1"),
  base_selector: { type: "branch", value: "main" },
  completed_at: "2026-07-28T12:00:00.000Z",
  created_at: "2026-07-28T12:00:00.000Z",
  effective_outcome: "clear",
  execution_status: "completed",
  head_commit: oid("2"),
  head_selector: { type: "branch", value: "topic" },
  id: "evaluation-complete",
  monitor: {
    duration_ms: 1_000,
    finding_counts: { advisory: 0, blocking: 0, total: 0 },
    nodes: [
      {
        key: "preparing",
        kind: "system",
        label: "Preparing",
        status: "completed",
      },
      {
        kind: "review",
        label: "Security",
        review_id: "review-1",
        review_version_id: "version-1",
        status: "completed",
      },
      {
        key: "finalizing",
        kind: "system",
        label: "Finalizing",
        status: "completed",
      },
    ],
    outcome_counts: { clear: 1, error: 0, not_applicable: 0, triggered: 0 },
    review_counts: {
      cancelled: 0,
      completed: 1,
      failed: 0,
      queued: 0,
      running: 0,
      total: 1,
    },
  },
  provenance: "explicit",
  repository: {
    id: "repository-1",
    url: "https://example.invalid/repository.git",
  },
  retry_state: "ready",
  ...overrides,
});

export function evaluationElements() {
  return /** @type {any} */ (
    new Map(
      [
        "evaluation-create-form",
        "evaluation-create-toggle",
        "evaluation-create-repository",
        "evaluation-create-base-type",
        "evaluation-create-base-value",
        "evaluation-create-head-type",
        "evaluation-create-head-value",
        "evaluation-create-submit",
        "evaluation-create-status",
        "evaluation-filter-form",
        "evaluation-filter-repository",
        "evaluation-filter-status",
        "evaluation-filter-outcome",
        "evaluation-filter-query",
        "evaluation-filter-start",
        "evaluation-filter-end",
        "evaluation-filter-reset",
        "evaluation-loading",
        "evaluation-empty",
        "evaluation-error",
        "evaluation-list",
        "evaluation-new-activity",
        "evaluation-load-more",
        "evaluation-stat-workers",
        "evaluation-stat-queue",
        "evaluation-stat-pass-rate",
        "evaluation-stat-p95",
        "evaluation-stat-updated",
        "evaluation-stat-window-24h",
        "evaluation-stat-window-7d",
      ].map((id) => [id, browserElement({ hidden: true })]),
    )
  );
}
