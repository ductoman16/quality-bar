import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";
import { derivePullRequestCriterionTransitions } from "../src/analytics-filter.js";
import { evaluation, progression } from "./analytics-filter-support.js";

test("Analytics filters one visible population and derives only adjacent recorded same-PR Criterion transitions", () => {
  const evaluations = [
    evaluation("evaluation-1", 100, "blocking"),
    evaluation("evaluation-2", 200, "clear"),
    evaluation("evaluation-3", 300, "error"),
    evaluation("evaluation-4", 400, "clear"),
    evaluation("evaluation-5", 500, "clear"),
  ];
  const progressions = [
    progression("evaluation-1", 100, "triggered"),
    progression("evaluation-2", 200, "clear"),
    progression("evaluation-3", 300, "triggered"),
    progression("evaluation-4", 400, null),
    progression("evaluation-5", 500, "not_applicable"),
    progression("other-pr-1", 150, "triggered", {
      pull_request_number: 99,
    }),
    progression("other-pr-2", 250, "error", {
      pull_request_number: 99,
    }),
  ];
  const analytics = createAnalyticsService({
    all(sql) {
      if (sql.includes("AS analytics_filter_rows")) {
        return progressions;
      }
      if (sql.includes("AS analytics_transition_rows")) {
        return progressions;
      }
      if (sql.includes("FROM evaluations")) {
        return evaluations;
      }
      if (sql.includes("AS analytics_criterion_rows")) {
        return [
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-1",
            outcome: "triggered",
          },
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-2",
            outcome: "clear",
          },
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-3",
            outcome: "triggered",
          },
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-5",
            outcome: "not_applicable",
          },
        ];
      }
      return [];
    },
  });

  const document = analytics.read({
    criterion_id: "criterion-1",
    end: 600,
    pull_request_number: 42,
    repository_id: "repository-1",
    start: 100,
  });

  assert.deepEqual(document.population, {
    filters: {
      criterion_id: "criterion-1",
      end: 600,
      pull_request_number: 42,
      repository_id: "repository-1",
      start: 100,
    },
    matching_evaluations: 5,
    matching_waiver_adjudications: 0,
    matching_waiver_decisions: 0,
    matching_waiver_requests: 0,
    pending_adjudications: 0,
    pending_evaluations: 0,
    state: "ready",
    total_evaluations: 5,
  });
  assert.deepEqual(document.pull_request_criterion_transitions, {
    no_longer_applicable: 0,
    sample_size: 1,
    triggered_to_clear: 1,
    triggered_to_error: 0,
  });
});

test("Analytics keeps triggered transition outcomes distinct", () => {
  /** @type {Array<[string, "triggered_to_clear" | "triggered_to_error" | "no_longer_applicable"]>} */
  const cases = [
    ["clear", "triggered_to_clear"],
    ["error", "triggered_to_error"],
    ["not_applicable", "no_longer_applicable"],
  ];
  for (const [outcome, expected] of cases) {
    const rows = [
      progression("evaluation-1", 100, "triggered"),
      progression("evaluation-2", 200, outcome),
    ];
    const transitions = derivePullRequestCriterionTransitions(
      rows,
      new Set(["evaluation-1", "evaluation-2"]),
      new Set([
        "evaluation-1\0review-1\0criterion-1",
        "evaluation-2\0review-1\0criterion-1",
      ]),
    );
    assert.equal(transitions[expected], 1);
    assert.equal(transitions.sample_size, 1);
    assert.equal(
      Object.values(transitions).reduce((sum, count) => sum + count, 0),
      2,
    );
  }
});

test("Analytics rejects invalid half-open boundaries before querying canonical facts", () => {
  let queried = false;
  const analytics = createAnalyticsService({
    all() {
      queried = true;
      return [];
    },
  });

  assert.throws(() => analytics.read({ end: 10, start: 10 }), {
    code: "analytics_filter_invalid",
    message: "Analytics filter is invalid",
  });
  assert.equal(queried, false);
});

test("Analytics combines exact Changeset, Review lineage, version, configuration, and terminal-outcome filters", () => {
  const target = evaluation("evaluation-1", 100, "blocking", {
    blocking_finding_count: 1,
  });
  const other = evaluation("evaluation-2", 200, "clear");
  const facts = [
    progression("evaluation-1", 100, "triggered"),
    progression("evaluation-2", 200, "clear", {
      model: "gpt-5.3-codex",
      review_version_id: "review-version-2",
    }),
  ];
  const analytics = createAnalyticsService({
    all(sql) {
      if (sql.includes("AS analytics_filter_rows")) {
        return facts;
      }
      if (sql.includes("AS analytics_transition_rows")) {
        return facts;
      }
      return sql.includes("FROM evaluations") ? [target, other] : [];
    },
  });

  const document = analytics.read({
    base_commit: "a".repeat(40),
    criterion_id: "criterion-1",
    head_commit: "1".repeat(40),
    model: "gpt-5.4",
    pull_request_number: 42,
    reasoning_effort: "high",
    repository_id: "repository-1",
    review_id: "review-1",
    review_version_id: "review-version-1",
    service_tier: "standard",
    terminal_outcome: "blocking",
  });

  assert.equal(document.population.matching_evaluations, 1);
  assert.deepEqual(document.population.filters, {
    base_commit: "a".repeat(40),
    criterion_id: "criterion-1",
    head_commit: "1".repeat(40),
    model: "gpt-5.4",
    pull_request_number: 42,
    reasoning_effort: "high",
    repository_id: "repository-1",
    review_id: "review-1",
    review_version_id: "review-version-1",
    service_tier: "standard",
    terminal_outcome: "blocking",
  });
});

test("Review and Criterion filters exclude sibling facts from one matching Evaluation", () => {
  const targetEvaluation = evaluation("evaluation-1", 100, "blocking", {
    blocking_finding_count: 1,
  });
  const scopes = [
    progression("evaluation-1", 100, "triggered"),
    progression("evaluation-1", 100, "clear", {
      criterion_id: "criterion-2",
      review_id: "review-2",
      review_version_id: "review-version-2",
    }),
  ];
  const analytics = createAnalyticsService({
    all(sql) {
      if (
        sql.includes("AS analytics_filter_rows") ||
        sql.includes("AS analytics_transition_rows")
      ) {
        return scopes;
      }
      if (sql.includes("FROM applicability_results")) {
        return [
          {
            evaluation_id: "evaluation-1",
            outcome: "applicable",
            review_id: "review-1",
          },
          {
            evaluation_id: "evaluation-1",
            outcome: "applicable",
            review_id: "review-2",
          },
        ];
      }
      if (sql.includes("AS analytics_criterion_rows")) {
        return [
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-1",
            outcome: "triggered",
            review_id: "review-1",
            review_run_id: "review-run-1",
          },
          {
            criterion_id: "criterion-2",
            evaluation_id: "evaluation-1",
            outcome: "clear",
            review_id: "review-2",
            review_run_id: "review-run-2",
          },
        ];
      }
      if (sql.includes("AS analytics_review_run_rows")) {
        return ["review-1", "review-2"].map((reviewId, index) => ({
          cached_input_tokens: null,
          cancellation_code: null,
          completed_at: 130,
          created_at: 100,
          criterion_result_count: 1,
          error_code: null,
          evaluation_id: "evaluation-1",
          execution_status: "completed",
          finding_count: index,
          id: `review-run-${index + 1}`,
          input_tokens: 10,
          model: "gpt-5.4",
          output_tokens: 5,
          reasoning_effort: "high",
          review_id: reviewId,
          review_version_id: `review-version-${index + 1}`,
          service_tier: "standard",
          started_at: 110,
          waiver_decision_count: 0,
          waiver_request_count: 0,
        }));
      }
      if (sql.includes("AS analytics_adjudication_scope_rows")) {
        return ["review-1", "review-2"].map((reviewId, index) => ({
          criterion_id: `criterion-${index + 1}`,
          evaluation_id: "evaluation-1",
          review_id: reviewId,
          review_run_id: `review-run-${index + 1}`,
          waiver_adjudication_id: `adjudication-${index + 1}`,
        }));
      }
      if (sql.includes("AS analytics_waiver_adjudications")) {
        return [1, 2].map((number) => ({
          cached_input_tokens: null,
          completed_at: 140,
          error_code: null,
          evaluation_id: "evaluation-1",
          execution_status: "completed",
          id: `adjudication-${number}`,
          input_tokens: 4,
          model: "gpt-5.4",
          output_tokens: 2,
          reasoning_effort: "high",
          service_tier: "standard",
          started_at: 120,
        }));
      }
      return sql.includes("FROM evaluations") ? [targetEvaluation] : [];
    },
  });

  const document = analytics.read({ review_id: "review-1" });

  assert.deepEqual(
    document.review_applicability.map(({ review_id: reviewId }) => reviewId),
    ["review-1"],
  );
  assert.deepEqual(
    document.criterion_outcomes.map(
      ({ criterion_id: criterionId }) => criterionId,
    ),
    ["criterion-1"],
  );
  assert.deepEqual(
    document.matching_facts.review_runs.map(
      ({ review_run_id: reviewRunId }) => reviewRunId,
    ),
    ["review-run-1"],
  );
  assert.deepEqual(document.matching_facts.review_runs[0].criterion_results, [
    { criterion_id: "criterion-1", outcome: "triggered" },
  ]);
  assert.equal(document.waiver_adjudication_reliability.completed, 1);
});

test("Waiver activity uses its event clock without dropping an older Evaluation", () => {
  /** @type {import("node:sqlite").SQLInputValue[][]} */
  const queriedWindows = [];
  const olderEvaluation = evaluation("evaluation-1", 50, "advisory");
  const analytics = createAnalyticsService({
    all(sql, ...parameters) {
      if (
        sql.includes("waiver_requests.created_at") ||
        sql.includes("AS analytics_decision_rows") ||
        sql.includes("analytics_waiver_adjudications.created_at")
      ) {
        queriedWindows.push(parameters);
      }
      if (sql.includes("AS has_waiver_request")) {
        return [
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-1",
            has_accepted_decision: 1,
            has_waiver_request: 1,
            review_id: "review-1",
          },
        ];
      }
      if (sql.includes("AS analytics_decision_rows")) {
        return [
          {
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-1",
            outcome: "accepted",
            review_id: "review-1",
          },
        ];
      }
      if (sql.includes("SELECT waiver_requests.id AS waiver_request_id")) {
        return [
          {
            created_at: 150,
            criterion_id: "criterion-1",
            evaluation_id: "evaluation-1",
            finding_id: "finding-1",
            review_id: "review-1",
            review_run_id: "review-run-1",
            waiver_request_id: "waiver-request-1",
          },
        ];
      }
      if (
        sql.includes("AS analytics_filter_rows") ||
        sql.includes("AS analytics_transition_rows")
      ) {
        return [progression("evaluation-1", 50, "triggered")];
      }
      return sql.includes("FROM evaluations") ? [olderEvaluation] : [];
    },
  });

  const document = analytics.read({ end: 200, start: 100 });

  assert.equal(document.population.matching_evaluations, 0);
  assert.equal(document.population.matching_waiver_requests, 1);
  assert.equal(document.population.matching_waiver_decisions, 1);
  assert.equal(document.population.state, "ready");
  assert.equal(document.waiver_analytics.requested_findings, 1);
  assert.equal(document.waiver_analytics.waived_findings, 1);
  assert.equal(document.waiver_analytics.decision_history.accepted, 1);
  assert.ok(
    queriedWindows.every(
      (parameters) => parameters.includes(100) && parameters.includes(200),
    ),
  );
});
