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
