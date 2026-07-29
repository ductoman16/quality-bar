import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunEvidenceService } from "../src/review-run-evidence.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createReviewService } from "../src/review.js";
import { startApplication } from "./http-integration-support.js";

const protocolVersion = "2025-11-25";
const baseCommit = "1".repeat(40);
const headCommit = "2".repeat(40);

/** @param {string} token */
function mcpHeaders(token) {
  return {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  };
}

/** @param {string} method @param {unknown} params @param {number} id */
function requestMessage(method, params, id) {
  return { id, jsonrpc: "2.0", method, params };
}

/**
 * @param {string} origin
 * @param {Record<string, string>} headers
 * @param {unknown} message
 */
async function callMcp(origin, headers, message) {
  const response = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 200);
  return /** @type {any} */ (await response.json());
}

/** @param {string} idempotencyKey @param {string} [repositoryId] */
function requestEvaluationArguments(
  idempotencyKey,
  repositoryId = "repository-1",
) {
  return {
    base_selector: { name: "main", type: "branch" },
    head_selector: { name: "topic", type: "branch" },
    idempotency_key: idempotencyKey,
    repository_id: repositoryId,
  };
}

test("MCP durably requests and polls an Evaluation, then reads every complete result resource", async () => {
  const { application, origin, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: baseCommit,
          head_commit: headCommit,
        }),
        createId: () => "evaluation-1",
        createReviewRunId: () => "review-run-1",
        now: () => 10,
      });
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/mcp-evaluation.git",
    1,
    1,
  );
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-2",
    "https://example.invalid/other-mcp-evaluation.git",
    2,
    2,
  );
  let reviewFact = 0;
  createReviewService(application.durableCore, {
    createId: () => `mcp-evaluation-review-${++reviewFact}`,
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Prove the MCP claim." }],
    description: "MCP Evaluation Review",
    name: "MCP Evaluation",
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token);

  const requested = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: requestEvaluationArguments("mcp-evaluation-key"),
        name: "quality_bar.request_evaluation",
      },
      1,
    ),
  );
  assert.equal(requested.result.isError, false);
  assert.equal(requested.result.structuredContent.execution_status, "queued");
  assert.deepEqual(
    application.durableCore.get(
      `SELECT channel, route
       FROM evaluation_idempotency
       WHERE idempotency_key = ?`,
      "mcp-evaluation-key",
    ),
    { channel: "mcp", route: "quality_bar.request_evaluation" },
  );

  const replayed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: requestEvaluationArguments("mcp-evaluation-key"),
        name: "quality_bar.request_evaluation",
      },
      2,
    ),
  );
  assert.deepEqual(
    replayed.result.structuredContent,
    requested.result.structuredContent,
  );
  const conflict = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: requestEvaluationArguments(
          "mcp-evaluation-key",
          "repository-2",
        ),
        name: "quality_bar.request_evaluation",
      },
      3,
    ),
  );
  assert.equal(
    conflict.result.structuredContent.error.code,
    "idempotency_conflict",
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM evaluations")
      ?.count,
    1,
  );

  const polled = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { evaluation_id: "evaluation-1" },
        name: "quality_bar.get_evaluation",
      },
      4,
    ),
  );
  assert.deepEqual(
    polled.result.structuredContent,
    requested.result.structuredContent,
  );
  const httpEvaluation = await request("/api/v1/evaluations/evaluation-1", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.deepEqual(
    polled.result.structuredContent,
    await httpEvaluation.json(),
  );
  const earlyResult = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { evaluation_id: "evaluation-1" },
        name: "quality_bar.get_evaluation_result",
      },
      5,
    ),
  );
  assert.equal(earlyResult.result.isError, true);
  assert.equal(earlyResult.result.structuredContent.error.code, "not_ready");
  assert.equal("review_runs" in earlyResult.result.structuredContent, false);
  const earlyResultResource = await callMcp(
    origin,
    headers,
    requestMessage(
      "resources/read",
      { uri: "quality-bar://v1/evaluations/evaluation-1/result" },
      12,
    ),
  );
  assert.equal(earlyResultResource.error.code, -32000);
  assert.equal(earlyResultResource.error.data.error.code, "not_ready");

  const claims = createReviewRunClaimService(application.durableCore, {
    createWorkerId: () => "mcp-evaluation-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  const criterionId = /** @type {string} */ (
    application.durableCore.get(
      `SELECT review_version_criteria.criterion_id
       FROM review_version_criteria
       JOIN review_runs
         ON review_runs.review_version_id =
              review_version_criteria.review_version_id
       WHERE review_runs.id = ?`,
      "review-run-1",
    )?.criterion_id
  );
  createReviewRunResultService(application.durableCore, {
    createFindingId: () => "finding-1",
    now: () => 30,
  }).prepare(
    claim,
    {
      criterion_results: [
        {
          criterion_id: criterionId,
          findings: [
            {
              evidence: "The MCP-visible concern is exact.",
              location: { kind: "changeset" },
              remediation: "Resolve the exact concern.",
            },
          ],
          outcome: "triggered",
        },
      ],
    },
    [],
  );
  createReviewRunEvidenceService(application.durableCore).complete(claim, {
    exitCode: 0,
    signal: null,
    tokenCounters: {
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
    },
  });

  const completed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { evaluation_id: "evaluation-1" },
        name: "quality_bar.get_evaluation_result",
      },
      6,
    ),
  );
  assert.equal(completed.result.isError, false);
  assert.equal(completed.result.structuredContent.review_runs.length, 1);
  assert.equal(completed.result.structuredContent.findings.length, 1);
  const httpResult = await request("/api/v1/evaluations/evaluation-1/result", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.deepEqual(completed.result.structuredContent, await httpResult.json());
  const completedEvaluation = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { evaluation_id: "evaluation-1" },
        name: "quality_bar.get_evaluation",
      },
      11,
    ),
  );

  for (const [
    id,
    uri,
    expected,
  ] of /** @type {Array<[number, string, unknown]>} */ ([
    [
      7,
      "quality-bar://v1/evaluations/evaluation-1",
      completedEvaluation.result.structuredContent,
    ],
    [
      8,
      "quality-bar://v1/evaluations/evaluation-1/result",
      completed.result.structuredContent,
    ],
    [
      9,
      "quality-bar://v1/review-runs/review-run-1",
      completed.result.structuredContent.review_runs[0],
    ],
    [
      10,
      "quality-bar://v1/findings/finding-1",
      completed.result.structuredContent.findings[0],
    ],
  ])) {
    const resource = await callMcp(
      origin,
      headers,
      requestMessage("resources/read", { uri }, id),
    );
    assert.deepEqual(JSON.parse(resource.result.contents[0].text), expected);
    assert.equal(resource.result.contents[0].uri, uri);
  }
});
