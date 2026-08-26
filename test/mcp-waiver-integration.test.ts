import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { startApplication } from "./http-integration-support.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

const protocolVersion = "2025-11-25";

function mcpHeaders(token: string) {
  return {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  };
}

function requestMessage(method: string, params: unknown, id: number) {
  return { id, jsonrpc: "2.0", method, params };
}

async function callMcp(
  origin: string,
  headers: Record<string, string>,
  message: unknown,
) {
  const response = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}

function submission(key: string, findingId: string, rationale: string) {
  return {
    evaluation_id: "evaluation-1",
    idempotency_key: key,
    requests: [{ finding_id: findingId, rationale }],
  };
}

test("MCP submits and polls one canonical waiver workflow through authenticated HTTP", async () => {
  const adjudicationIds = ["adjudication-1"];
  const requestIds = ["request-1"];
  let now = 10;
  const { application, origin, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        createWaiverAdjudicationId: () =>
          adjudicationIds.shift() ?? assert.fail("missing Adjudication id"),
        createWaiverRequestId: () =>
          requestIds.shift() ?? assert.fail("missing Request id"),
        now: () => now,
      });
    },
  });
  seedCompletedEvaluation(application.durableCore);
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token);

  const created = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: submission(
          "waiver-key",
          "finding-1",
          "The exact generated evidence warrants an exception.",
        ),
        name: "quality_bar.submit_waiver_requests",
      },
      1,
    ),
  );
  assert.equal(created.result.isError, false);
  assert.equal(
    created.result.structuredContent.adjudication.execution_status,
    "queued",
  );
  assert.deepEqual(
    application.durableCore.get(
      `SELECT channel, route FROM waiver_batch_idempotency
       WHERE idempotency_key = 'waiver-key'`,
    ),
    {
      channel: "implementer_token",
      route: "quality_bar.submit_waiver_requests",
    },
  );

  const active = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { waiver_adjudication_id: "adjudication-1" },
        name: "quality_bar.get_waiver_adjudication",
      },
      4,
    ),
  );
  assert.equal(active.result.structuredContent.execution_status, "queued");
  assert.equal("decisions" in active.result.structuredContent, false);
  const requestResource = await callMcp(
    origin,
    headers,
    requestMessage(
      "resources/read",
      { uri: "quality-bar://v1/waiver-requests/request-1" },
      5,
    ),
  );
  const httpRequest = await request("/api/v1/waiver-requests/request-1", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.deepEqual(
    JSON.parse(requestResource.result.contents[0].text),
    await httpRequest.json(),
  );

  application.durableCore.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-1', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  application.durableCore.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-1'`,
  );
  now = 12;
  createWaiverAdjudicationResultService(application.durableCore, {
    createDecisionId: () => "decision-1",
    now: () => now,
  }).prepare(
    {
      fencingToken: 1,
      workerId: "worker-1",
      workId: "adjudication-1",
    },
    {
      decisions: [
        {
          explanation: "The frozen evidence proves this exact exception.",
          outcome: "accepted",
          request_id: "request-1",
        },
      ],
    },
  );
  const completed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { waiver_adjudication_id: "adjudication-1" },
        name: "quality_bar.get_waiver_adjudication",
      },
      6,
    ),
  );
  assert.deepEqual(
    completed.result.structuredContent.decisions.map(
      (decision: { id: string }) => decision.id,
    ),
    ["decision-1"],
  );
  const decisionResource = await callMcp(
    origin,
    headers,
    requestMessage(
      "resources/read",
      { uri: "quality-bar://v1/waiver-decisions/decision-1" },
      7,
    ),
  );
  const httpDecision = await request("/api/v1/waiver-decisions/decision-1", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.deepEqual(
    JSON.parse(decisionResource.result.contents[0].text),
    await httpDecision.json(),
  );
});
