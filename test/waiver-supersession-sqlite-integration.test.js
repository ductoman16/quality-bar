import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createEvaluationCollectionReader } from "../src/evaluation/evaluation-collection-reader.js";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("an old Evaluation Waiver Decision cannot carry into a newer Changeset", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-head-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-old-head",
    createRequestId: () => "request-old-head",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "old-head-waiver",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "The old frozen Changeset has an exact exception.",
        },
      ],
    },
  });
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'old-head-worker', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-old-head'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-old-head'`,
  );

  const newerBase = "c".repeat(40);
  const newerHead = "d".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status,
       created_at, completed_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'completed', 12, 12
     )`,
    newerBase,
    newerHead,
    newerBase,
    newerHead,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 12 WHERE id = 'evaluation-2'",
  );
  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-2', 'clear', 12)`,
  );

  const evaluations = createEvaluationCollectionReader(
    core,
    Buffer.alloc(32, 7),
  );
  assert.equal(evaluations.read("evaluation-2").effective_outcome, "clear");
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-old-head",
    now: () => 13,
  }).prepare(
    {
      fencingToken: 1,
      workerId: "old-head-worker",
      workId: "adjudication-old-head",
    },
    {
      decisions: [
        {
          explanation: "The old frozen evidence proves this exception.",
          outcome: "accepted",
          request_id: "request-old-head",
        },
      ],
    },
  );

  assert.equal(evaluations.read("evaluation-1").effective_outcome, "blocking");
  assert.equal(evaluations.read("evaluation-2").effective_outcome, "clear");
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM waiver_decisions
       JOIN waiver_requests
         ON waiver_requests.id = waiver_decisions.waiver_request_id
       WHERE waiver_requests.evaluation_id = 'evaluation-2'`,
    )?.count,
    0,
  );
});
