import assert from "node:assert/strict";
import { test } from "node:test";

import { createHttpConformanceAssertion } from "../scripts/openapi-conformance.mjs";
import { canonicalOpenApiDocument } from "../src/canonical-api.js";
import { createUnavailableEvaluationService } from "../src/evaluation.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

const document = {
  criterion_outcomes: [],
  evaluation_overview: {
    clear_count: 1,
    duration_sample_count: 1,
    p95_duration_ms: 120,
    clear_rate: { denominator: 4, numerator: 1 },
    terminal_count: 4,
    window: { end: 200, start: 100 },
  },
  evaluation_outcomes: {
    advisory: 1,
    advisory_rate: { denominator: 4, numerator: 1 },
    blocking: 1,
    blocking_rate: { denominator: 4, numerator: 1 },
    clear: 1,
    clear_rate: { denominator: 4, numerator: 1 },
    error: 1,
    error_rate: { denominator: 4, numerator: 1 },
    pending: 2,
  },
  finding_impact: {
    advisory: 2,
    blocking: 1,
    findings_per_triggered_criterion_result: {
      denominator: 2,
      numerator: 3,
    },
  },
  matching_facts: {
    evaluations: [
      {
        base_commit: "a".repeat(40),
        created_at: 100,
        evaluation_id: "evaluation-1",
        head_commit: "b".repeat(40),
        pull_request_number: 42,
        repository_id: "repository-1",
        terminal_outcome: "clear",
      },
    ],
    review_runs: [
      {
        base_commit: "a".repeat(40),
        cached_input_tokens: null,
        cancellation_code: null,
        completed_at: 220,
        created_at: 100,
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "triggered" },
        ],
        error_code: null,
        evaluation_id: "evaluation-1",
        execution_status: "completed",
        findings: [
          {
            criterion_id: "criterion-1",
            finding_id: "finding-1",
            impact: "advisory",
          },
        ],
        head_commit: "b".repeat(40),
        input_tokens: 30,
        model: "gpt-5.4",
        output_tokens: 8,
        pull_request_number: 42,
        reasoning_effort: "high",
        repository_id: "repository-1",
        review_id: "review-1",
        review_run_id: "review-run-1",
        review_version_id: "review-version-1",
        service_tier: "standard",
        started_at: 120,
        waiver_decisions: [
          {
            created_at: 180,
            outcome: "accepted",
            waiver_decision_id: "waiver-decision-1",
            waiver_request_id: "waiver-request-1",
          },
        ],
        waiver_requests: [
          {
            created_at: 160,
            finding_id: "finding-1",
            waiver_request_id: "waiver-request-1",
          },
        ],
      },
    ],
  },
  population: {
    filters: {},
    matching_evaluations: 6,
    matching_waiver_adjudications: 1,
    matching_waiver_decisions: 3,
    matching_waiver_requests: 1,
    pending_adjudications: 0,
    pending_evaluations: 2,
    state: "pending_data",
    total_evaluations: 6,
  },
  pull_request_criterion_transitions: {
    no_longer_applicable: 1,
    sample_size: 3,
    triggered_to_clear: 1,
    triggered_to_error: 1,
  },
  review_applicability: [
    {
      applicable: 2,
      applicability_rate: { denominator: 3, numerator: 2 },
      error: 1,
      error_rate: { denominator: 4, numerator: 1 },
      not_applicable: 1,
      review_id: "review-1",
    },
  ],
  review_run_reliability: {
    active: 1,
    duration: {
      failed: { execution_count: 0, median_ms: null, total_ms: null },
      operator_cancelled: {
        execution_count: 0,
        median_ms: null,
        total_ms: null,
      },
      successful: { execution_count: 1, median_ms: 120, total_ms: 120 },
      superseded: { execution_count: 0, median_ms: null, total_ms: null },
      terminal: { execution_count: 1, median_ms: 120, total_ms: 120 },
    },
    failed: 0,
    failed_rate: { denominator: 1, numerator: 0 },
    failure_codes: [],
    operator_cancelled: 0,
    operator_cancelled_rate: { denominator: 1, numerator: 0 },
    successful: 1,
    successful_rate: { denominator: 1, numerator: 1 },
    superseded: 0,
    superseded_rate: { denominator: 1, numerator: 0 },
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 1, numerator: 0 },
        median: null,
        sum: null,
      },
      input_tokens: {
        coverage: { denominator: 1, numerator: 1 },
        median: 10,
        sum: 10,
      },
      output_tokens: {
        coverage: { denominator: 1, numerator: 1 },
        median: 5,
        sum: 5,
      },
    },
  },
  waiver_analytics: {
    advisory_findings: 2,
    decision_history: {
      accepted: 1,
      accepted_rate: { denominator: 3, numerator: 1 },
      denied: 1,
      denied_rate: { denominator: 3, numerator: 1 },
      error: 1,
      error_rate: { denominator: 3, numerator: 1 },
    },
    requested_findings: 1,
    waived_findings: 1,
    waived_finding_rate: { denominator: 2, numerator: 1 },
    waiver_request_rate: { denominator: 2, numerator: 1 },
  },
  waiver_adjudication_reliability: {
    active: 0,
    cancelled: 0,
    cancelled_rate: { denominator: 1, numerator: 0 },
    completed: 1,
    completed_rate: { denominator: 1, numerator: 1 },
    duration: {
      cancelled: { execution_count: 0, median_ms: null, total_ms: null },
      completed: { execution_count: 1, median_ms: 80, total_ms: 80 },
      failed: { execution_count: 0, median_ms: null, total_ms: null },
      terminal: { execution_count: 1, median_ms: 80, total_ms: 80 },
    },
    failed: 0,
    failed_rate: { denominator: 1, numerator: 0 },
    failure_codes: [],
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 1, numerator: 0 },
        median: null,
        sum: null,
      },
      input_tokens: {
        coverage: { denominator: 1, numerator: 1 },
        median: 4,
        sum: 4,
      },
      output_tokens: {
        coverage: { denominator: 1, numerator: 1 },
        median: 2,
        sum: 2,
      },
    },
  },
};

test("the canonical Analytics document conforms to the published HTTP schema", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  await assertion.assertExchange({
    request: {
      method: "GET",
      url: "http://127.0.0.1/api/v1/analytics",
    },
    response: Response.json(document),
  });
  assert.equal(assertion.facts().responseDocuments, 1);
});

test("the canonical Analytics schema rejects inexact provenance and failure codes", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  for (const matchingFacts of [
    {
      ...document.matching_facts,
      evaluations: [
        {
          ...document.matching_facts.evaluations[0],
          base_commit: "not-a-commit",
        },
      ],
    },
    {
      ...document.matching_facts,
      review_runs: [
        {
          ...document.matching_facts.review_runs[0],
          error_code: "Not Stable",
        },
      ],
    },
  ]) {
    await assert.rejects(
      () =>
        assertion.assertExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/analytics",
          },
          response: Response.json({
            ...document,
            matching_facts: matchingFacts,
          }),
        }),
      /openapi_success_document_invalid/,
    );
  }
});

test("HTTP exposes the canonical Analytics document to browser and machine authorities", async () => {
  const { application, request } = await startApplication({
    createEvaluations() {
      return {
        ...createUnavailableEvaluationService(new Error("unused Evaluation")),
        readAnalytics: () => document,
      };
    },
  });
  const operator = await authenticatedOperatorHeaders(request);
  const browserResponse = await request("/api/v1/analytics", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(browserResponse.status, 200);
  assert.deepEqual(await browserResponse.json(), document);

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machineResponse = await request("/api/v1/analytics", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineResponse.status, 200);
  assert.deepEqual(await machineResponse.json(), document);

  const malformed = await request("/api/v1/analytics?unexpected=1", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(malformed.status, 400);
  assert.equal(await responseErrorCode(malformed), "request_malformed");
});

test("HTTP accepts exact Analytics filters and preserves their half-open boundaries", async () => {
  let received;
  const filteredDocument = {
    ...document,
    population: {
      filters: {
        criterion_id: "criterion-1",
        end: 200,
        repository_id: "repository-1",
        start: 100,
      },
      matching_evaluations: 1,
      matching_waiver_adjudications: 0,
      matching_waiver_decisions: 0,
      matching_waiver_requests: 0,
      pending_adjudications: 0,
      pending_evaluations: 0,
      state: "ready",
      total_evaluations: 6,
    },
  };
  const { request } = await startApplication({
    createEvaluations() {
      return {
        ...createUnavailableEvaluationService(new Error("unused Evaluation")),
        readAnalytics(filters) {
          received = filters;
          return filteredDocument;
        },
      };
    },
  });
  const operator = await authenticatedOperatorHeaders(request);
  const response = await request(
    "/api/v1/analytics?repository_id=repository-1&criterion_id=criterion-1&start=100&end=200",
    { headers: { cookie: operator.cookie } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    criterion_id: "criterion-1",
    end: 200,
    repository_id: "repository-1",
    start: 100,
  });
  assert.deepEqual(await response.json(), filteredDocument);

  const invalid = await request("/api/v1/analytics?start=200&end=100", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(invalid.status, 400);
  assert.equal(await responseErrorCode(invalid), "analytics_filter_invalid");
  for (const value of ["", "%20", "0x10", "01"]) {
    const malformed = await request(`/api/v1/analytics?start=${value}`, {
      headers: { cookie: operator.cookie },
    });
    assert.equal(malformed.status, 400);
    assert.equal(
      await responseErrorCode(malformed),
      "analytics_filter_invalid",
    );
  }
});

test("HTTP surfaces the exact Analytics query failure without fallback data", async () => {
  const { request } = await startApplication({
    createEvaluations() {
      return createUnavailableEvaluationService(
        Object.assign(new Error("Analytics query failed"), {
          code: "analytics_query_failed",
        }),
      );
    },
  });
  const operator = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/analytics", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(response.status, 500);
  assert.equal(await responseErrorCode(response), "analytics_query_failed");
});

test("HTTP preserves an unavailable Analytics owner as a service gate", async () => {
  const { request } = await startApplication({
    createEvaluations() {
      return createUnavailableEvaluationService(
        Object.assign(new Error("Canonical storage is unavailable"), {
          code: "storage_unavailable",
        }),
      );
    },
  });
  const operator = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/analytics", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(response.status, 503);
  assert.equal(await responseErrorCode(response), "storage_unavailable");
});
