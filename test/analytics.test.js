import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";

test("Analytics derives honest Review applicability and stable Criterion rates", () => {
  const queries = [];
  const analytics = createAnalyticsService({
    all(sql) {
      queries.push(sql);
      return sql.includes("applicability_results")
        ? [
            { outcome: "applicable", review_id: "review-1" },
            { outcome: "applicable", review_id: "review-1" },
            { outcome: "not_applicable", review_id: "review-1" },
            { outcome: "error", review_id: "review-1" },
            { outcome: "error", review_id: "review-2" },
          ]
        : [
            { criterion_id: "criterion-1", outcome: "triggered" },
            { criterion_id: "criterion-1", outcome: "clear" },
            { criterion_id: "criterion-1", outcome: "not_applicable" },
            { criterion_id: "criterion-1", outcome: "error" },
            { criterion_id: "criterion-2", outcome: "not_applicable" },
          ];
    },
  });

  assert.deepEqual(analytics.read(), {
    criterion_outcomes: [
      {
        clear: 1,
        clear_rate: { denominator: 2, numerator: 1 },
        criterion_id: "criterion-1",
        error: 1,
        error_rate: { denominator: 4, numerator: 1 },
        not_applicable: 1,
        not_applicable_rate: { denominator: 4, numerator: 1 },
        trigger_rate: { denominator: 2, numerator: 1 },
        triggered: 1,
      },
      {
        clear: 0,
        clear_rate: { denominator: 0, numerator: 0 },
        criterion_id: "criterion-2",
        error: 0,
        error_rate: { denominator: 1, numerator: 0 },
        not_applicable: 1,
        not_applicable_rate: { denominator: 1, numerator: 1 },
        trigger_rate: { denominator: 0, numerator: 0 },
        triggered: 0,
      },
    ],
    review_applicability: [
      {
        applicable: 2,
        applicability_rate: { denominator: 3, numerator: 2 },
        error: 1,
        error_rate: { denominator: 4, numerator: 1 },
        not_applicable: 1,
        review_id: "review-1",
      },
      {
        applicable: 0,
        applicability_rate: { denominator: 0, numerator: 0 },
        error: 1,
        error_rate: { denominator: 1, numerator: 1 },
        not_applicable: 0,
        review_id: "review-2",
      },
    ],
  });
  assert.equal(queries.length, 2);
});

test("Analytics query failure surfaces one exact owning error without a partial result", () => {
  const cause = new Error("database interrupted");
  const analytics = createAnalyticsService({
    all() {
      throw cause;
    },
  });

  assert.throws(
    () => analytics.read(),
    (error) => {
      const failure = /** @type {Error & {code?: string}} */ (error);
      return (
        failure.code === "analytics_query_failed" &&
        failure.message === "Analytics query failed" &&
        failure.cause === cause
      );
    },
  );
});
