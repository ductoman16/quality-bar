import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executeEvaluationTool,
  matchWorkflowResource,
  readWorkflowResource,
  requestEvaluationArguments,
  resultChildResourceLinks,
} from "../src/mcp-evaluation.js";

const commit = "a".repeat(40);

test("MCP Evaluation input maps only the two exact selector shapes", () => {
  assert.deepEqual(
    requestEvaluationArguments({
      base_selector: { name: "main", type: "branch" },
      head_selector: { object_id: commit, type: "commit" },
      idempotency_key: "request-key",
      repository_id: "repository-1",
    }),
    {
      idempotencyKey: "request-key",
      repositoryId: "repository-1",
      request: {
        base: { type: "branch", value: "main" },
        head: { type: "commit", value: commit },
      },
    },
  );
  for (const invalid of [
    {},
    {
      base_selector: { name: "main", type: "branch", unexpected: true },
      head_selector: { object_id: commit, type: "commit" },
      idempotency_key: "request-key",
      repository_id: "repository-1",
    },
  ]) {
    assert.throws(() => requestEvaluationArguments(invalid), {
      code: "request_malformed",
    });
  }
});

test("MCP Evaluation dispatch fails unknown tools and maps only Result readiness", async () => {
  const evaluations = /** @type {any} */ ({
    read() {
      return { id: "evaluation-1" };
    },
    readResult() {
      throw Object.assign(new Error("Evaluation Result is not ready"), {
        code: "evaluation_result_not_ready",
      });
    },
  });
  await assert.rejects(
    executeEvaluationTool(
      "quality_bar.get_evaluation_result",
      { evaluation_id: "evaluation-1" },
      evaluations,
    ),
    { code: "not_ready" },
  );
  await assert.rejects(
    executeEvaluationTool(
      "quality_bar.unknown",
      { evaluation_id: "evaluation-1" },
      evaluations,
    ),
    { code: "request_malformed", message: "Unknown Evaluation tool" },
  );
});

test("complete Result links and fixed resource matches stay exact", () => {
  assert.deepEqual(
    resultChildResourceLinks(
      /** @type {any} */ ({
        findings: [{ id: "finding/1" }],
        review_runs: [{ id: "review-run/1" }],
      }),
    ).map(({ uri }) => uri),
    [
      "quality-bar://v1/review-runs/review-run%2F1",
      "quality-bar://v1/findings/finding%2F1",
    ],
  );
  assert.deepEqual(
    matchWorkflowResource("quality-bar://v1/evaluations/evaluation%2F1/result"),
    { id: "evaluation/1", kind: "evaluations", suffix: "/result" },
  );
  assert.equal(
    matchWorkflowResource("quality-bar://v1/repositories/repository-1/result"),
    null,
  );
});

test("future waiver resource addresses fail exact not-found until their owning facts exist", () => {
  const match = matchWorkflowResource(
    "quality-bar://v1/waiver-requests/waiver-request-1",
  );
  assert.ok(match);
  assert.throws(
    () =>
      readWorkflowResource(match, {
        evaluations: /** @type {any} */ ({}),
        repositories: /** @type {any} */ ({}),
        repositoryGuidance: /** @type {any} */ ({}),
      }),
    { code: "waiver_request_not_found" },
  );
});
