import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/** @param {any} core @param {"accepted" | "denied" | null} outcome */
function prepareRequest(core, outcome) {
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "request-1",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "Exact original rationale.",
        },
      ],
    },
  });
  if (outcome === null) {
    return;
  }
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-1', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-1'`,
  );
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-1",
    now: () => 12,
  }).prepare(
    { fencingToken: 1, workerId: "worker-1", workId: "adjudication-1" },
    {
      decisions: [
        {
          explanation: `${outcome} exact request`,
          outcome,
          request_id: "request-1",
        },
      ],
    },
  );
}

function insertLaterAdjudication(/** @type {any} */ core) {
  core.run(
    `INSERT INTO waiver_adjudications (
       id, evaluation_id, base_commit, head_commit, model,
       reasoning_effort, service_tier, execution_status, created_at,
       error_code, error_detail
     ) VALUES (
       'later-adjudication', 'evaluation-1', ?, ?,
       'gpt-5.6-terra', 'high', 'standard', 'failed', 20,
       'codex_process_failed', 'Codex process failed'
     )`,
    "a".repeat(40),
    "b".repeat(40),
  );
}

for (const outcome of [null, "accepted", "denied"]) {
  test(`a ${outcome ?? "pending"} Request cannot be associated with a later Adjudication`, () => {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-waiver-${outcome ?? "pending"}-retry-`),
    );
    const core = openDurableCore(join(directory, "quality-bar.sqlite"));
    try {
      seedCompletedEvaluation(core);
      prepareRequest(
        core,
        /** @type {"accepted" | "denied" | null} */ (outcome),
      );
      insertLaterAdjudication(core);
      assert.throws(
        () =>
          core.run(
            `INSERT INTO waiver_adjudication_requests (
               waiver_adjudication_id, waiver_request_id, position
             ) VALUES ('later-adjudication', 'request-1', 1)`,
          ),
        /waiver_request_retry_ineligible/,
      );
    } finally {
      core.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

test("a denied Request requires a revised trimmed rationale in persistence", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-revised-rationale-"),
  );
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    prepareRequest(core, "denied");
    assert.throws(
      () =>
        core.run(
          `INSERT INTO waiver_requests (
             id, evaluation_id, finding_id, rationale,
             requester_channel, created_at
           ) VALUES (
             'request-2', 'evaluation-1', 'finding-1',
             '  Exact original rationale.  ', 'browser_session', 20
           )`,
        ),
      /waiver_request_duplicate/,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
