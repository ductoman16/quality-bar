import assert from "node:assert/strict";
import { test } from "node:test";

import { createUnavailableEvaluationService } from "../src/evaluation.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

const document = {
  criterion_outcomes: [],
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
};

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
