import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEvaluationCollection,
  readEvaluationCollectionFilters,
} from "../src/evaluation-collection.js";
import { readEvaluationMonitors } from "../src/evaluation-monitor.js";

/**
 * @param {string} id
 * @param {string} status
 * @param {{result?: string | null, counts?: Record<string, number>}} [options]
 */
function summary(id, status, { result = null, counts = {} } = {}) {
  return {
    evaluation_id: id,
    finding_advisory: counts.finding_advisory ?? 0,
    finding_blocking: counts.finding_blocking ?? 0,
    finding_total: counts.finding_total ?? 0,
    outcome_clear: counts.outcome_clear ?? 0,
    outcome_error: counts.outcome_error ?? 0,
    outcome_not_applicable: counts.outcome_not_applicable ?? 0,
    outcome_triggered: counts.outcome_triggered ?? 0,
    result_evaluation_id: result,
    review_cancelled: 0,
    review_completed: status === "completed" ? 1 : 0,
    review_execution_status: status,
    review_failed: status === "failed" ? 1 : 0,
    review_id: "review-1",
    review_name: "Review one",
    review_queued: status === "queued" ? 1 : 0,
    review_run_id: "review-run-1",
    review_running: status === "running" ? 1 : 0,
    review_total: 1,
    review_version_id: "review-version-1",
  };
}

/** @param {string} id @param {string | null} [result] */
function noRuns(id, result = null) {
  return {
    evaluation_id: id,
    finding_advisory: 0,
    finding_blocking: 0,
    finding_total: 0,
    outcome_clear: 0,
    outcome_error: 0,
    outcome_not_applicable: 0,
    outcome_triggered: 0,
    result_evaluation_id: result,
    review_cancelled: 0,
    review_completed: 0,
    review_execution_status: null,
    review_failed: 0,
    review_id: null,
    review_name: null,
    review_queued: 0,
    review_run_id: null,
    review_running: 0,
    review_total: 0,
    review_version_id: null,
  };
}

/**
 * @param {string} id
 * @param {string} executionStatus
 * @param {number | null} [applicabilitySealedAt]
 */
function evaluation(id, executionStatus, applicabilitySealedAt = null) {
  return {
    applicability_sealed_at: applicabilitySealedAt,
    completed_at: ["completed", "failed", "cancelled"].includes(executionStatus)
      ? 20
      : null,
    created_at: 10,
    execution_status: executionStatus,
    id,
  };
}

/**
 * @param {Record<string, import("node:sqlite").SQLInputValue>[]} rows
 * @param {Record<string, import("node:sqlite").SQLInputValue>[]} evaluations
 */
function monitors(rows, evaluations) {
  return readEvaluationMonitors({ all: () => rows }, evaluations);
}

test("monitor lifecycle derives system nodes exclusively from persisted Evaluation and Review Run facts", () => {
  const rows = [
    noRuns("queued"),
    summary("running", "running"),
    summary("completed", "completed", { result: "completed" }),
    noRuns("failed"),
    noRuns("cancelled"),
    noRuns("zero", "zero"),
  ];
  const values = monitors(rows, [
    evaluation("queued", "queued"),
    evaluation("running", "running"),
    evaluation("completed", "completed", 15),
    evaluation("failed", "failed"),
    evaluation("cancelled", "cancelled"),
    evaluation("zero", "completed", 15),
  ]);
  assert.deepEqual(
    [...values.entries()].map(([id, value]) => [
      id,
      value.nodes[0].status,
      value.nodes.at(-1).status,
    ]),
    [
      ["queued", "queued", "queued"],
      ["running", "running", "queued"],
      ["completed", "completed", "completed"],
      ["failed", "failed", "failed"],
      ["cancelled", "cancelled", "cancelled"],
      ["zero", "completed", "completed"],
    ],
  );
  assert.equal(values.get("queued")?.outcome_counts, null);
  assert.equal(values.get("zero")?.review_counts.total, 0);
});

test("monitor preserves review query order and exposes immutable result counts", () => {
  const rows = [
    {
      ...summary("parallel", "completed", {
        counts: {
          finding_advisory: 1,
          finding_blocking: 2,
          finding_total: 3,
          outcome_clear: 4,
          outcome_error: 1,
          outcome_not_applicable: 2,
          outcome_triggered: 3,
        },
        result: "parallel",
      }),
      review_id: "review-1",
      review_name: "First review",
      review_run_id: "run-2",
      review_version_id: "version-1",
    },
    {
      ...summary("parallel", "completed", {
        counts: {
          finding_advisory: 1,
          finding_blocking: 2,
          finding_total: 3,
          outcome_clear: 4,
          outcome_error: 1,
          outcome_not_applicable: 2,
          outcome_triggered: 3,
        },
        result: "parallel",
      }),
      review_id: "review-2",
      review_name: "Second review",
      review_run_id: "run-1",
      review_version_id: "version-2",
    },
  ];
  for (const row of rows) {
    row.review_total = 2;
    row.review_completed = 2;
  }
  const value = monitors(rows, [evaluation("parallel", "completed", 11)]).get(
    "parallel",
  );
  assert.deepEqual(
    value?.nodes
      .slice(1, -1)
      .map((/** @type {{review_id?: string}} */ node) => node.review_id),
    ["review-1", "review-2"],
  );
  assert.deepEqual(value?.outcome_counts, {
    clear: 4,
    error: 1,
    not_applicable: 2,
    triggered: 3,
  });
  assert.deepEqual(value?.finding_counts, {
    advisory: 1,
    blocking: 2,
    total: 3,
  });
  assert.equal(value?.duration_ms, 10);
});

test("monitor rejects a negative stored duration", () => {
  assert.throws(
    () =>
      monitors(
        [noRuns("negative", "negative")],
        [
          {
            ...evaluation("negative", "completed", 11),
            completed_at: 9,
          },
        ],
      ),
    /duration is invalid/,
  );
});

test("collection filters canonicalize inputs and bind cursor fingerprints", () => {
  assert.deepEqual(
    readEvaluationCollectionFilters({
      effective_outcome: "advisory",
      end: "30",
      execution_status: "completed",
      query: "123",
      repository_id: "repository-1",
      start: "10",
    }),
    {
      effective_outcome: "advisory",
      end: 30,
      execution_status: "completed",
      query: "123",
      repository_id: "repository-1",
      start: 10,
    },
  );
  assert.throws(() => readEvaluationCollectionFilters({ query: "" }), {
    code: "evaluation_filter_invalid",
  });
  assert.throws(
    () => readEvaluationCollectionFilters({ end: "10", start: "10" }),
    { code: "evaluation_filter_invalid" },
  );

  let calls = 0;
  const collection = createEvaluationCollection(
    Buffer.alloc(32, 7),
    ({ after }) => {
      calls += 1;
      if (after) {
        return [];
      }
      return [
        { created_at: 20, id: "second" },
        { created_at: 10, id: "first" },
      ];
    },
  );
  const first = collection.read({ limit: "1", repository_id: "repository-1" });
  assert.equal(calls, 1);
  assert.ok(first.next_cursor);
  assert.throws(
    () =>
      collection.read({
        cursor: first.next_cursor ?? undefined,
        repository_id: "repository-2",
      }),
    { code: "cursor_invalid" },
  );
  collection.destroy();
});
