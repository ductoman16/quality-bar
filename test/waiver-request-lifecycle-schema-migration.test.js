import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/** @param {any} core @param {string} adjudicationId @param {string} requestId @param {"accepted" | "denied"} outcome */
function completeWaiverDecision(core, adjudicationId, requestId, outcome) {
  const workerId = `worker-${adjudicationId}`;
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = ?, fencing_token = 1,
         lease_expires_at = 100, started_at = 20
     WHERE work_id = ?`,
    workerId,
    adjudicationId,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 20,
         codex_cli_version = '0.145.0'
     WHERE id = ?`,
    adjudicationId,
  );
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => `decision-${adjudicationId}`,
    now: () => 21,
  }).prepare(
    { fencingToken: 1, workerId, workId: adjudicationId },
    {
      decisions: [
        {
          explanation: `${outcome} migrated request`,
          outcome,
          request_id: requestId,
        },
      ],
    },
  );
}

/** @param {any} core @param {string} findingId @param {number} index */
function submitMigratedRequest(core, findingId, index) {
  const adjudicationId = `migrated-adjudication-${findingId}-${index}`;
  const requestId = `migrated-request-${findingId}-${index}`;
  createWaiverBatchService(core, {
    createAdjudicationId: () => adjudicationId,
    createRequestId: () => requestId,
    now: () => 10 + index,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: `migrated-key-${findingId}-${index}`,
    request: {
      requests: [
        {
          finding_id: findingId,
          rationale: `Migrated rationale ${findingId} ${index}.`,
        },
      ],
    },
  });
  return { adjudicationId, requestId };
}

/** @param {string} databasePath @param {40 | 41} version @param {string} invalidStatements */
function downgradeLifecycleHistory(databasePath, version, invalidStatements) {
  const deployed = new DatabaseSync(databasePath);
  deployed.exec(`
    BEGIN IMMEDIATE;
    DROP TRIGGER waiver_request_limit_insert;
    DROP TRIGGER waiver_request_after_acceptance_insert;
    DROP TRIGGER waiver_request_sequence_insert;
    DROP TRIGGER waiver_request_rationale_revised_insert;
    DROP TRIGGER waiver_adjudication_request_retry_insert;
    ${invalidStatements}
    UPDATE quality_bar_metadata
    SET value = '${version}' WHERE key = 'schema_version';
    PRAGMA user_version = ${version};
    COMMIT;
  `);
  deployed.close();
}

for (const version of /** @type {const} */ ([40, 41])) {
  test(`schema v${version} installs every subsequent Waiver Request lifecycle guard`, () => {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-waiver-v${version}-migrate-`),
    );
    const databasePath = join(directory, "quality-bar.sqlite");
    const current = openDurableCore(databasePath);
    seedCompletedEvaluation(current);
    current.close();

    downgradeLifecycleHistory(databasePath, version, "");

    const migrated = openDurableCore(databasePath);
    try {
      assert.equal(migrated.facts.schemaVersion, 45);
      assert.deepEqual(
        migrated
          .all(
            `SELECT name FROM sqlite_schema
           WHERE type = 'trigger'
             AND name IN (
               'waiver_request_limit_insert',
               'waiver_request_after_acceptance_insert',
               'waiver_request_sequence_insert',
               'waiver_request_rationale_revised_insert',
               'waiver_adjudication_request_retry_insert'
             )
           ORDER BY name`,
          )
          .map((/** @type {any} */ row) => row.name),
        [
          "waiver_adjudication_request_retry_insert",
          "waiver_request_after_acceptance_insert",
          "waiver_request_limit_insert",
          "waiver_request_rationale_revised_insert",
          "waiver_request_sequence_insert",
        ],
      );

      const accepted = submitMigratedRequest(migrated, "finding-1", 1);
      completeWaiverDecision(
        migrated,
        accepted.adjudicationId,
        accepted.requestId,
        "accepted",
      );
      assert.throws(
        () =>
          migrated.run(
            `INSERT INTO waiver_requests (
             id, evaluation_id, finding_id, rationale,
             requester_channel, created_at
           ) VALUES (
             'post-acceptance-request', 'evaluation-1', 'finding-1',
             'Later rationale', 'browser_session', 30
           )`,
          ),
        /waiver_request_(?:accepted|previous_not_denied)/,
      );

      const firstDenied = submitMigratedRequest(migrated, "finding-2", 1);
      assert.throws(
        () =>
          migrated.run(
            `INSERT INTO waiver_requests (
             id, evaluation_id, finding_id, rationale,
             requester_channel, created_at
           ) VALUES (
             'pre-decision-request', 'evaluation-1', 'finding-2',
             'Premature rationale', 'browser_session', 31
           )`,
          ),
        /waiver_request_previous_not_denied/,
      );
      completeWaiverDecision(
        migrated,
        firstDenied.adjudicationId,
        firstDenied.requestId,
        "denied",
      );
      for (const index of [2, 3]) {
        const denied = submitMigratedRequest(migrated, "finding-2", index);
        completeWaiverDecision(
          migrated,
          denied.adjudicationId,
          denied.requestId,
          "denied",
        );
      }
      assert.throws(
        () =>
          migrated.run(
            `INSERT INTO waiver_requests (
             id, evaluation_id, finding_id, rationale,
             requester_channel, created_at
           ) VALUES (
             'fourth-request', 'evaluation-1', 'finding-2',
             'Fourth rationale', 'browser_session', 32
           )`,
          ),
        /waiver_request_limit_reached/,
      );
    } finally {
      migrated.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

/** @type {Array<{name: string, prepare: (core: any) => void, statements: string}>} */
const invalidLifecycleHistories = [
  {
    name: "more than three Requests",
    prepare() {},
    statements: `
      INSERT INTO waiver_requests (
        id, evaluation_id, finding_id, rationale,
        requester_channel, created_at
      ) VALUES
        ('raw-1', 'evaluation-1', 'finding-1', 'Rationale 1', 'browser_session', 1),
        ('raw-2', 'evaluation-1', 'finding-1', 'Rationale 2', 'browser_session', 2),
        ('raw-3', 'evaluation-1', 'finding-1', 'Rationale 3', 'browser_session', 3),
        ('raw-4', 'evaluation-1', 'finding-1', 'Rationale 4', 'browser_session', 4);
    `,
  },
  {
    name: "a later Request without a prior denial",
    prepare() {},
    statements: `
      INSERT INTO waiver_requests (
        id, evaluation_id, finding_id, rationale,
        requester_channel, created_at
      ) VALUES
        ('raw-1', 'evaluation-1', 'finding-1', 'Rationale 1', 'browser_session', 1),
        ('raw-2', 'evaluation-1', 'finding-1', 'Rationale 2', 'browser_session', 2);
    `,
  },
  {
    name: "an unchanged revised rationale",
    prepare(core) {
      const denied = submitMigratedRequest(core, "finding-1", 1);
      completeWaiverDecision(
        core,
        denied.adjudicationId,
        denied.requestId,
        "denied",
      );
    },
    statements: `
      INSERT INTO waiver_requests (
        id, evaluation_id, finding_id, rationale,
        requester_channel, created_at
      ) VALUES (
        'raw-duplicate', 'evaluation-1', 'finding-1',
        '  Migrated rationale finding-1 1.  ', 'browser_session', 20
      );
    `,
  },
  {
    name: "a later association after acceptance",
    prepare(core) {
      const accepted = submitMigratedRequest(core, "finding-1", 1);
      completeWaiverDecision(
        core,
        accepted.adjudicationId,
        accepted.requestId,
        "accepted",
      );
    },
    statements: `
      INSERT INTO waiver_adjudications (
        id, evaluation_id, base_commit, head_commit, model,
        reasoning_effort, service_tier, execution_status, created_at,
        error_code, error_detail
      ) VALUES (
        'raw-later-adjudication', 'evaluation-1',
        '${"a".repeat(40)}', '${"b".repeat(40)}',
        'gpt-5.6-terra', 'high', 'standard', 'failed', 20,
        'codex_process_failed', 'Codex process failed'
      );
      INSERT INTO waiver_adjudication_requests (
        waiver_adjudication_id, waiver_request_id, position
      ) VALUES (
        'raw-later-adjudication', 'migrated-request-finding-1-1', 1
      );
    `,
  },
];

for (const version of /** @type {const} */ ([40, 41])) {
  for (const history of invalidLifecycleHistories) {
    test(`schema v${version} rejects ${history.name}`, () => {
      const directory = mkdtempSync(
        join(tmpdir(), `quality-bar-waiver-v${version}-invalid-`),
      );
      const databasePath = join(directory, "quality-bar.sqlite");
      const current = openDurableCore(databasePath);
      seedCompletedEvaluation(current);
      history.prepare(current);
      current.close();
      downgradeLifecycleHistory(databasePath, version, history.statements);

      assert.throws(
        () => openDurableCore(databasePath),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "schema_invalid" &&
          error.message === "SQLite schema could not be initialized" &&
          error.cause instanceof Error &&
          /waiver_request_lifecycle_history_invalid/.test(error.cause.message),
      );
      rmSync(directory, { force: true, recursive: true });
    });
  }
}
