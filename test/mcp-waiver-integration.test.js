import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { startApplication } from "./http-integration-support.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

const protocolVersion = "2025-11-25";

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

/** @param {string} origin @param {Record<string, string>} headers @param {unknown} message */
async function callMcp(origin, headers, message) {
  const response = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 200);
  return /** @type {any} */ (await response.json());
}

/** @param {string} key @param {string} findingId @param {string} rationale */
function submission(key, findingId, rationale) {
  return {
    evaluation_id: "evaluation-1",
    idempotency_key: key,
    requests: [{ finding_id: findingId, rationale }],
  };
}

test("MCP atomically submits and polls canonical waiver resources through completion and failure", async () => {
  const adjudicationIds = ["adjudication-1", "adjudication-2"];
  const requestIds = ["request-1", "request-2"];
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

  const replayed = await callMcp(
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
      2,
    ),
  );
  assert.deepEqual(
    replayed.result.structuredContent,
    created.result.structuredContent,
  );
  const conflict = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: submission(
          "waiver-key",
          "finding-1",
          "Different canonical input.",
        ),
        name: "quality_bar.submit_waiver_requests",
      },
      3,
    ),
  );
  assert.equal(
    conflict.result.structuredContent.error.code,
    "idempotency_conflict",
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM waiver_requests")
      ?.count,
    1,
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
      (/** @type {{id: string}} */ decision) => decision.id,
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

  now = 20;
  const second = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: submission(
          "second-key",
          "finding-2",
          "The second exact exception.",
        ),
        name: "quality_bar.submit_waiver_requests",
      },
      8,
    ),
  );
  assert.equal(second.result.isError, false);
  application.durableCore.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-2', fencing_token = 1,
         lease_expires_at = 100, started_at = 21
     WHERE work_id = 'adjudication-2'`,
  );
  application.durableCore.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 21,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-2'`,
  );
  now = 22;
  createWaiverAdjudicationResultService(application.durableCore, {
    createDecisionId: () => assert.fail("failure created a Decision"),
    now: () => now,
  }).fail(
    {
      fencingToken: 1,
      workerId: "worker-2",
      workId: "adjudication-2",
    },
    Object.assign(new Error("Codex exited before submitting Decisions"), {
      code: "codex_process_failed",
    }),
  );
  const failed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { waiver_adjudication_id: "adjudication-2" },
        name: "quality_bar.get_waiver_adjudication",
      },
      9,
    ),
  );
  assert.deepEqual(failed.result.structuredContent.error, {
    code: "codex_process_failed",
    detail: "Codex exited before submitting Decisions",
  });
  assert.equal("decisions" in failed.result.structuredContent, false);
});
