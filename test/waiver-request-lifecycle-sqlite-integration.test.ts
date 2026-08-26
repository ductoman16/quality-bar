import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function startAdjudication(core: any, adjudicationId: string) {
  const workerId = `worker-${adjudicationId}`;
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = ?, fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = ?`,
    workerId,
    adjudicationId,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = ?`,
    adjudicationId,
  );
  return workerId;
}

function submitRequest(
  core: any,
  {
    adjudicationId,
    key,
    rationale,
    requestId,
  }: {
    adjudicationId: string;
    key: string;
    rationale: string;
    requestId: string;
  },
) {
  return createWaiverBatchService(core, {
    createAdjudicationId: () => adjudicationId,
    createRequestId: () => requestId,
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: key,
    request: {
      requests: [{ finding_id: "finding-1", rationale }],
    },
  });
}

function decide(
  core: any,
  {
    adjudicationId,
    decisionId,
    outcome,
    requestId,
  }: {
    adjudicationId: string;
    decisionId: string;
    outcome: "accepted" | "denied" | "error";
    requestId: string;
  },
) {
  const workerId = startAdjudication(core, adjudicationId);
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => decisionId,
    now: () => 12,
  }).prepare(
    { fencingToken: 1, workerId, workId: adjudicationId },
    {
      decisions: [
        outcome === "error"
          ? {
              error: {
                code: "required_evidence_unavailable",
                detail: "Required frozen evidence is unavailable.",
              },
              outcome,
              request_id: requestId,
            }
          : {
              explanation: `${outcome} exact request`,
              outcome,
              request_id: requestId,
            },
      ],
    },
  );
}

for (const [outcome, errorCode] of [
  ["accepted", "waiver_request_accepted"],
  ["error", "waiver_request_error_retry_required"],
]) {
  test(`a fresh Request is rejected after a ${outcome} Decision`, () => {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-waiver-${outcome}-`),
    );
    const core = openDurableCore(join(directory, "quality-bar.sqlite"));
    try {
      seedCompletedEvaluation(core);
      submitRequest(core, {
        adjudicationId: "adjudication-1",
        key: "request-1",
        rationale: "First exact rationale.",
        requestId: "request-1",
      });
      decide(core, {
        adjudicationId: "adjudication-1",
        decisionId: "decision-1",
        outcome: outcome as "accepted" | "error",
        requestId: "request-1",
      });

      assert.throws(
        () =>
          submitRequest(core, {
            adjudicationId: "adjudication-unused",
            key: "request-2",
            rationale: "A different exact rationale.",
            requestId: "request-unused",
          }),
        (error) =>
          error instanceof Error && "code" in error && error.code === errorCode,
      );
      assert.equal(
        core.get(
          "SELECT count(*) AS count FROM waiver_requests WHERE finding_id = 'finding-1'",
        )?.count,
        1,
      );
      assert.throws(
        () =>
          core.run(
            `INSERT INTO waiver_requests (
               id, evaluation_id, finding_id, rationale,
               requester_channel, created_at
             ) VALUES (
               'raw-request', 'evaluation-1', 'finding-1',
               'Raw later rationale', 'browser_session', 20
             )`,
          ),
        outcome === "accepted"
          ? /waiver_request_(?:accepted|previous_not_denied)/
          : /waiver_request_previous_not_denied/,
      );
    } finally {
      core.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

test("denials permit revised immutable Requests through the third slot only", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-denials-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    for (let index = 1; index <= 3; index += 1) {
      submitRequest(core, {
        adjudicationId: `adjudication-${index}`,
        key: `request-${index}`,
        rationale: `Revised exact rationale ${index}.`,
        requestId: `request-${index}`,
      });
      decide(core, {
        adjudicationId: `adjudication-${index}`,
        decisionId: `decision-${index}`,
        outcome: "denied",
        requestId: `request-${index}`,
      });
    }
    assert.throws(
      () =>
        submitRequest(core, {
          adjudicationId: "adjudication-unused",
          key: "request-4",
          rationale: "Fourth exact rationale.",
          requestId: "request-unused",
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_request_limit_reached",
    );
    assert.throws(
      () =>
        core.run(
          `INSERT INTO waiver_requests (
             id, evaluation_id, finding_id, rationale,
             requester_channel, created_at
           ) VALUES (
             'raw-request-4', 'evaluation-1', 'finding-1',
             'Raw fourth rationale', 'browser_session', 20
           )`,
        ),
      /waiver_request_limit_reached/,
    );
    assert.deepEqual(
      core.all(
        `SELECT waiver_requests.id, waiver_decisions.outcome
         FROM waiver_requests
         JOIN waiver_decisions
           ON waiver_decisions.waiver_request_id = waiver_requests.id
         WHERE waiver_requests.finding_id = 'finding-1'
         ORDER BY waiver_requests.rowid`,
      ),
      [
        { id: "request-1", outcome: "denied" },
        { id: "request-2", outcome: "denied" },
        { id: "request-3", outcome: "denied" },
      ],
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an error retry queues the same immutable Request and newest Decision controls", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-error-retry-"),
  );
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    submitRequest(core, {
      adjudicationId: "adjudication-1",
      key: "request-1",
      rationale: "The generated evidence is temporarily unavailable.",
      requestId: "request-1",
    });
    decide(core, {
      adjudicationId: "adjudication-1",
      decisionId: "decision-error",
      outcome: "error",
      requestId: "request-1",
    });
    const retries = createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-2",
      createRequestId: () => assert.fail("retry created a Request"),
      now: () => 5,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    });
    const retried = retries.retryErrors({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "retry-1",
      request: { request_ids: ["request-1"] },
    });
    assert.equal(retried.status, 201);
    assert.deepEqual(retried.resource.adjudication.request_ids, ["request-1"]);
    assert.deepEqual(
      retries.retryErrors({
        channel: "browser_session",
        evaluationId: "evaluation-1",
        idempotencyKey: "retry-1",
        request: { request_ids: ["request-1"] },
      }),
      retried,
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_requests")?.count,
      1,
    );
    assert.deepEqual(
      core.all(
        `SELECT waiver_adjudication_id, waiver_request_id
         FROM waiver_adjudication_requests ORDER BY rowid`,
      ),
      [
        {
          waiver_adjudication_id: "adjudication-1",
          waiver_request_id: "request-1",
        },
        {
          waiver_adjudication_id: "adjudication-2",
          waiver_request_id: "request-1",
        },
      ],
    );

    decide(core, {
      adjudicationId: "adjudication-2",
      decisionId: "decision-accepted",
      outcome: "accepted",
      requestId: "request-1",
    });
    assert.equal(
      core.get(
        `SELECT waiver_decisions.outcome
         FROM waiver_decisions
         JOIN waiver_adjudications
           ON waiver_adjudications.id =
                waiver_decisions.waiver_adjudication_id
         WHERE waiver_decisions.waiver_request_id = 'request-1'
         ORDER BY waiver_adjudications.rowid DESC
         LIMIT 1`,
      )?.outcome,
      "accepted",
    );
    assert.throws(
      () =>
        createWaiverBatchService(core, {
          createAdjudicationId: () => "adjudication-unused",
          createRequestId: () => assert.fail("retry created a Request"),
          now: () => 20,
          readCodexCapabilityFailure: () => null,
          storageReserve: { assertWorkAdmissionAvailable() {} },
        }).retryErrors({
          channel: "browser_session",
          evaluationId: "evaluation-1",
          idempotencyKey: "retry-after-accepted",
          request: { request_ids: ["request-1"] },
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_error_retry_ineligible",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
