import assert from "node:assert/strict";
import { resolve } from "node:path";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";
import { renderEvaluationMonitorPage } from "../src/evaluation-monitor-page.js";
import { browserElement } from "./repository-browser-component-support.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);

/** @param {string} page */
export function assertEvaluationPage(page) {
  const evaluationPage = renderEvaluationMonitorPage("evaluations");
  assert.ok(page.includes(evaluationPage.markup));
  assert.ok(page.includes(evaluationPage.scripts));
  const operatorIndex = page.indexOf("/assets/operator.js");
  const monitorIndex = page.indexOf("/assets/evaluation-monitor.js");
  const evaluationIndex = page.indexOf("/assets/evaluation.js");
  assert.ok(operatorIndex < monitorIndex);
  assert.ok(monitorIndex < evaluationIndex);
  assert.doesNotMatch(
    page,
    /evaluation-result\.js|evaluation-feedback\.js|waiver-batch\.js/,
  );
}

/** @param {Record<string, any>} context */
export function executeEvaluationMonitorContract(context) {
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/evaluation-monitor.js",
    readBrowserAsset("/assets/evaluation-monitor.js"),
    context,
  );
}

/** @param {Record<string, any>} context @param {"/assets/evaluation.js" | "/assets/evaluation-detail.js"} route */
export function executeEvaluationMonitorPageAsset(context, route) {
  executeEvaluationMonitorContract(context);
  executeServedBrowserAsset(
    resolve("."),
    `src/browser/${route.slice("/assets/".length)}`,
    readBrowserAsset(route),
    context,
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
        outcome: "clear",
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
        ...renderEvaluationMonitorPage("evaluations").markup.matchAll(
          /\bid="([^"]+)"/g,
        ),
      ].map(([, id]) => [id, browserElement({ hidden: true })]),
    )
  );
}
