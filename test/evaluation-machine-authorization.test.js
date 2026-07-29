import assert from "node:assert/strict";
import { test } from "node:test";

import { machineMayAccessEvaluationRoute } from "../src/evaluation-route.js";

test("implementer-token Evaluation authority is narrow and resource-based", () => {
  for (const [method, path] of [
    ["GET", "/api/v1/evaluations"],
    ["GET", "/api/v1/evaluations/evaluation-1"],
    ["GET", "/api/v1/evaluations/evaluation-1/result"],
    ["GET", "/api/v1/evaluations/evaluation-1/review-runs/review-run-1"],
    ["GET", "/api/v1/evaluations/evaluation-1/findings/finding-1"],
    ["POST", "/api/v1/repositories/repository-1/evaluations"],
  ]) {
    assert.equal(machineMayAccessEvaluationRoute(method, path), true);
  }

  for (const [method, path] of [
    ["POST", "/api/v1/evaluations/evaluation-1/cancel"],
    [
      "GET",
      "/api/v1/evaluations/evaluation-1/review-runs/review-run-1/diagnostics",
    ],
    ["POST", "/api/v1/evaluations/evaluation-1/retry"],
    ["POST", "/api/v1/evaluations/evaluation-1/review-runs"],
  ]) {
    assert.equal(machineMayAccessEvaluationRoute(method, path), false);
  }
});
