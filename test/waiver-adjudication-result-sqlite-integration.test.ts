import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createEvaluationCollectionReader } from "../src/evaluation/evaluation-collection-reader.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function preparedAdjudication(core: any) {
  const ids = ["request-1", "request-2"];
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => ids.shift() ?? assert.fail("missing id"),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [
        { finding_id: "finding-1", rationale: "Exact first exception." },
        { finding_id: "finding-2", rationale: "Exact second exception." },
      ],
    },
  });
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-1', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.114.0'
     WHERE id = 'adjudication-1'`,
  );
}

test("the first complete submission atomically stores every immutable Decision", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-result-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    preparedAdjudication(core);
    const decisionIds = ["decision-1", "decision-2"];
    const service = createWaiverAdjudicationResultService(core, {
      createDecisionId: () => decisionIds.shift() ?? assert.fail("missing id"),
      now: () => 12,
    });
    service.prepare(
      {
        fencingToken: 1,
        workerId: "worker-1",
        workId: "adjudication-1",
      },
      {
        decisions: [
          {
            explanation: "The exact first exception is justified.",
            outcome: "accepted",
            request_id: "request-1",
          },
          {
            explanation: "The second rationale is insufficient.",
            outcome: "denied",
            request_id: "request-2",
          },
        ],
      },
    );

    assert.deepEqual(
      core.all(
        `SELECT id, waiver_request_id, outcome, explanation
         FROM waiver_decisions ORDER BY id`,
      ),
      [
        {
          explanation: "The exact first exception is justified.",
          id: "decision-1",
          outcome: "accepted",
          waiver_request_id: "request-1",
        },
        {
          explanation: "The second rationale is insufficient.",
          id: "decision-2",
          outcome: "denied",
          waiver_request_id: "request-2",
        },
      ],
    );
    assert.deepEqual(
      core.get(
        "SELECT execution_status, completed_at FROM waiver_adjudications WHERE id = 'adjudication-1'",
      ),
      { completed_at: 12, execution_status: "completed" },
    );
    assert.throws(
      () =>
        core.run(
          "UPDATE waiver_decisions SET explanation = 'changed' WHERE id = 'decision-1'",
        ),
      /waiver_decision_immutable/,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an invalid partial candidate stores no Decisions and leaves the submission open", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-partial-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    preparedAdjudication(core);
    const service = createWaiverAdjudicationResultService(core, {
      createDecisionId: () => "decision-unused",
      now: () => 12,
    });
    assert.throws(
      () =>
        service.prepare(
          {
            fencingToken: 1,
            workerId: "worker-1",
            workId: "adjudication-1",
          },
          {
            decisions: [
              {
                explanation: "Only one Decision.",
                outcome: "accepted",
                request_id: "request-1",
              },
            ],
          },
        ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_adjudication_submission_invalid",
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
      0,
    );
    assert.equal(
      core.get(
        "SELECT execution_status FROM waiver_adjudications WHERE id = 'adjudication-1'",
      )?.execution_status,
      "running",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite rejects a raw partial Decision set as completed", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-raw-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    preparedAdjudication(core);
    core.run(
      `INSERT INTO waiver_decisions (
         id, waiver_adjudication_id, waiver_request_id, outcome,
         explanation, created_at
       ) VALUES (
         'decision-raw', 'adjudication-1', 'request-1', 'accepted',
         'Only one raw Decision.', 12
       )`,
    );
    assert.throws(
      () =>
        core.run(
          `UPDATE waiver_adjudications
           SET execution_status = 'completed', completed_at = 12
           WHERE id = 'adjudication-1'`,
        ),
      /waiver_adjudication_decisions_invalid/,
    );
    assert.equal(
      core.get(
        "SELECT execution_status FROM waiver_adjudications WHERE id = 'adjudication-1'",
      )?.execution_status,
      "running",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("current immutable waiver facts control only the exact Evaluation outcome", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-outcome-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    preparedAdjudication(core);
    const evaluations = createEvaluationCollectionReader(
      core,
      Buffer.alloc(32, 7),
    );
    assert.equal(evaluations.read("evaluation-1").effective_outcome, "pending");

    const decisionIds = ["decision-error", "decision-accepted"];
    createWaiverAdjudicationResultService(core, {
      createDecisionId: () => decisionIds.shift() ?? assert.fail("missing id"),
      now: () => 12,
    }).prepare(
      {
        fencingToken: 1,
        workerId: "worker-1",
        workId: "adjudication-1",
      },
      {
        decisions: [
          {
            error: {
              code: "required_evidence_unavailable",
              detail: "The frozen generated file is unavailable.",
            },
            outcome: "error",
            request_id: "request-1",
          },
          {
            explanation: "The exact second exception is justified.",
            outcome: "accepted",
            request_id: "request-2",
          },
        ],
      },
    );
    assert.equal(evaluations.read("evaluation-1").effective_outcome, "error");

    core.run(
      `INSERT INTO waiver_adjudications (
         id, evaluation_id, base_commit, head_commit, model,
         reasoning_effort, service_tier, execution_status, created_at
       ) SELECT 'adjudication-2', evaluation_id, base_commit, head_commit,
                model, reasoning_effort, service_tier, 'queued', 5
         FROM waiver_adjudications WHERE id = 'adjudication-1'`,
    );
    core.run(
      `INSERT INTO waiver_adjudication_requests (
         waiver_adjudication_id, waiver_request_id, position
       ) VALUES ('adjudication-2', 'request-1', 1)`,
    );
    core.run(
      `INSERT INTO codex_execution_queue (
         work_id, work_kind, ready_at, accepted_at, started_at,
         worker_id, fencing_token, lease_expires_at
       ) VALUES (
         'adjudication-2', 'waiver_adjudication', 5, 5, 5,
         'worker-2', 1, 100
       )`,
    );
    core.run(
      `UPDATE waiver_adjudications
       SET execution_status = 'running', started_at = 5,
           codex_cli_version = '0.114.0'
       WHERE id = 'adjudication-2'`,
    );
    assert.equal(evaluations.read("evaluation-1").effective_outcome, "pending");
    createWaiverAdjudicationResultService(core, {
      createDecisionId: () => "decision-retry-accepted",
      now: () => 6,
    }).prepare(
      {
        fencingToken: 1,
        workerId: "worker-2",
        workId: "adjudication-2",
      },
      {
        decisions: [
          {
            explanation: "The newly available evidence proves the exception.",
            outcome: "accepted",
            request_id: "request-1",
          },
        ],
      },
    );
    assert.equal(
      evaluations.read("evaluation-1").effective_outcome,
      "blocking",
    );
    assert.equal(
      core.get(
        "SELECT outcome FROM evaluation_results WHERE evaluation_id = 'evaluation-1'",
      )?.outcome,
      "advisory",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
