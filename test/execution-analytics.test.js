import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";

test("Analytics derives execution reliability, duration, and supplied token coverage without pre-start work", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      if (sql.includes("FROM review_runs AS analytics_review_runs")) {
        return [
          {
            cached_input_tokens: null,
            cancellation_code: null,
            completed_at: null,
            error_code: null,
            execution_status: "queued",
            input_tokens: null,
            output_tokens: null,
            started_at: null,
          },
          {
            cached_input_tokens: null,
            cancellation_code: null,
            completed_at: null,
            error_code: null,
            execution_status: "running",
            input_tokens: null,
            output_tokens: null,
            started_at: 100,
          },
          {
            cached_input_tokens: null,
            cancellation_code: null,
            completed_at: 200,
            error_code: null,
            execution_status: "completed",
            input_tokens: 10,
            output_tokens: 4,
            started_at: 100,
          },
          {
            cached_input_tokens: 5,
            cancellation_code: null,
            completed_at: 500,
            error_code: "codex_process_failed",
            execution_status: "failed",
            input_tokens: 20,
            output_tokens: null,
            started_at: 200,
          },
          {
            cached_input_tokens: null,
            cancellation_code: "cancelled_by_operator",
            completed_at: null,
            error_code: null,
            execution_status: "cancelled",
            input_tokens: null,
            output_tokens: null,
            started_at: null,
          },
          {
            cached_input_tokens: 0,
            cancellation_code: "cancelled_by_operator",
            completed_at: 800,
            error_code: null,
            execution_status: "cancelled",
            input_tokens: 0,
            output_tokens: 0,
            started_at: 400,
          },
        ];
      }
      if (
        sql.includes(
          "FROM waiver_adjudications AS analytics_waiver_adjudications",
        )
      ) {
        return [
          {
            cached_input_tokens: null,
            completed_at: null,
            error_code: null,
            execution_status: "queued",
            input_tokens: null,
            output_tokens: null,
            started_at: null,
          },
          {
            cached_input_tokens: null,
            completed_at: 1_100,
            error_code: null,
            execution_status: "completed",
            input_tokens: null,
            output_tokens: 8,
            started_at: 1_000,
          },
          {
            cached_input_tokens: 3,
            completed_at: 1_400,
            error_code: "codex_process_failed",
            execution_status: "failed",
            input_tokens: 6,
            output_tokens: 4,
            started_at: 1_200,
          },
          {
            cached_input_tokens: null,
            completed_at: 1_800,
            error_code: null,
            execution_status: "cancelled",
            input_tokens: null,
            output_tokens: null,
            started_at: 1_500,
          },
        ];
      }
      return [];
    },
  });

  const document = analytics.read();
  assert.deepEqual(document.review_run_reliability, {
    active: 2,
    duration: {
      failed: { execution_count: 1, median_ms: 300, total_ms: 300 },
      operator_cancelled: {
        execution_count: 1,
        median_ms: 400,
        total_ms: 400,
      },
      successful: { execution_count: 1, median_ms: 100, total_ms: 100 },
      superseded: { execution_count: 0, median_ms: null, total_ms: null },
      terminal: { execution_count: 3, median_ms: 300, total_ms: 800 },
    },
    failed: 1,
    failed_rate: { denominator: 3, numerator: 1 },
    failure_codes: [{ code: "codex_process_failed", count: 1 }],
    operator_cancelled: 1,
    operator_cancelled_rate: { denominator: 3, numerator: 1 },
    successful: 1,
    successful_rate: { denominator: 3, numerator: 1 },
    superseded: 0,
    superseded_rate: { denominator: 3, numerator: 0 },
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 3, numerator: 2 },
        median: 2.5,
        sum: 5,
      },
      input_tokens: {
        coverage: { denominator: 3, numerator: 3 },
        median: 10,
        sum: 30,
      },
      output_tokens: {
        coverage: { denominator: 3, numerator: 2 },
        median: 2,
        sum: 4,
      },
    },
  });
  assert.deepEqual(document.waiver_adjudication_reliability, {
    active: 1,
    cancelled: 1,
    cancelled_rate: { denominator: 3, numerator: 1 },
    completed: 1,
    completed_rate: { denominator: 3, numerator: 1 },
    duration: {
      cancelled: { execution_count: 1, median_ms: 300, total_ms: 300 },
      completed: { execution_count: 1, median_ms: 100, total_ms: 100 },
      failed: { execution_count: 1, median_ms: 200, total_ms: 200 },
      terminal: { execution_count: 3, median_ms: 200, total_ms: 600 },
    },
    failed: 1,
    failed_rate: { denominator: 3, numerator: 1 },
    failure_codes: [{ code: "codex_process_failed", count: 1 }],
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 3, numerator: 1 },
        median: 3,
        sum: 3,
      },
      input_tokens: {
        coverage: { denominator: 3, numerator: 1 },
        median: 6,
        sum: 6,
      },
      output_tokens: {
        coverage: { denominator: 3, numerator: 2 },
        median: 6,
        sum: 12,
      },
    },
  });
});

test("Analytics counts stable execution failure codes deterministically", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      if (!sql.includes("FROM review_runs AS analytics_review_runs")) {
        return [];
      }
      return [
        {
          cached_input_tokens: null,
          cancellation_code: null,
          completed_at: 20,
          error_code: "z_failure",
          execution_status: "failed",
          input_tokens: null,
          output_tokens: null,
          started_at: 10,
        },
        {
          cached_input_tokens: null,
          cancellation_code: null,
          completed_at: 30,
          error_code: "a_failure",
          execution_status: "failed",
          input_tokens: null,
          output_tokens: null,
          started_at: 20,
        },
        {
          cached_input_tokens: null,
          cancellation_code: null,
          completed_at: 40,
          error_code: "z_failure",
          execution_status: "failed",
          input_tokens: null,
          output_tokens: null,
          started_at: 30,
        },
      ];
    },
  });

  assert.deepEqual(analytics.read().review_run_reliability.failure_codes, [
    { code: "a_failure", count: 1 },
    { code: "z_failure", count: 2 },
  ]);
});

test("Analytics rejects an invalid execution fact with its exact owning error", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      return sql.includes("FROM review_runs AS analytics_review_runs")
        ? [
            {
              cached_input_tokens: null,
              cancellation_code: null,
              completed_at: 20,
              error_code: null,
              execution_status: "completed",
              input_tokens: null,
              output_tokens: null,
              started_at: null,
            },
          ]
        : [];
    },
  });

  assert.throws(() => analytics.read(), {
    code: "analytics_fact_invalid",
    message: "Canonical analytics fact is invalid",
  });
});

test("Analytics keeps superseded Review Runs separate from operator cancellation", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      if (!sql.includes("FROM review_runs AS analytics_review_runs")) {
        return [];
      }
      return [
        {
          cached_input_tokens: null,
          cancellation_code: "cancelled_by_operator",
          completed_at: 30,
          error_code: null,
          execution_status: "cancelled",
          input_tokens: null,
          output_tokens: null,
          started_at: 10,
        },
        {
          cached_input_tokens: null,
          cancellation_code: "cancelled_by_supersession",
          completed_at: 50,
          error_code: null,
          execution_status: "cancelled",
          input_tokens: null,
          output_tokens: null,
          started_at: 20,
        },
      ];
    },
  });

  const reliability = analytics.read().review_run_reliability;
  assert.equal(reliability.operator_cancelled, 1);
  assert.deepEqual(reliability.operator_cancelled_rate, {
    denominator: 2,
    numerator: 1,
  });
  assert.equal(reliability.superseded, 1);
  assert.deepEqual(reliability.superseded_rate, {
    denominator: 2,
    numerator: 1,
  });
  assert.deepEqual(reliability.duration.operator_cancelled, {
    execution_count: 1,
    median_ms: 20,
    total_ms: 20,
  });
  assert.deepEqual(reliability.duration.superseded, {
    execution_count: 1,
    median_ms: 30,
    total_ms: 30,
  });
});
