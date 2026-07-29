import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("schema v23 adds claim columns before widening the fixed queue", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-migrate-"));
  const databasePath = join(directory, "quality-bar.sqlite");
  const prior = openDurableCore(databasePath);
  prior.transaction((transaction) => {
    transaction.run("DROP INDEX codex_execution_queue_ready");
    transaction.run("DROP INDEX codex_execution_queue_worker");
    transaction.run("DROP TRIGGER codex_execution_queue_identity_update");
    transaction.run("DROP TRIGGER codex_execution_queue_reference_insert");
    transaction.run(
      "DROP TRIGGER codex_execution_queue_waiver_requests_insert",
    );
    transaction.run(
      "DROP TRIGGER codex_execution_queue_waiver_lifecycle_insert",
    );
    transaction.run("DROP TRIGGER codex_execution_queue_waiver_seal_insert");
    transaction.run("DROP TRIGGER codex_execution_queue_waiver_active_delete");
    transaction.run("DROP TRIGGER codex_execution_queue_claim_insert");
    transaction.run("DROP TRIGGER codex_execution_queue_claim_update");
    transaction.run("DROP TRIGGER review_run_queue_reference_delete");
    transaction.run("DROP TABLE waiver_batch_idempotency");
    transaction.run("DROP TABLE waiver_adjudication_requests");
    transaction.run("DROP TABLE waiver_requests");
    transaction.run("DROP TABLE waiver_adjudications");
    transaction.run(
      "ALTER TABLE codex_execution_queue RENAME TO codex_execution_queue_v35",
    );
    transaction.run(
      `CREATE TABLE codex_execution_queue (
         work_id TEXT PRIMARY KEY REFERENCES review_runs(id),
         work_kind TEXT NOT NULL CHECK (work_kind = 'review_run'),
         ready_at INTEGER NOT NULL,
         accepted_at INTEGER NOT NULL,
         started_at INTEGER,
         CHECK (started_at IS NULL OR started_at >= accepted_at)
       ) STRICT`,
    );
    transaction.run("DROP TABLE codex_execution_queue_v35");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '23' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 23");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  try {
    assert.equal(migrated.facts.schemaVersion, 37);
    assert.deepEqual(
      migrated
        .all("PRAGMA table_info(codex_execution_queue)")
        .map((/** @type {any} */ column) => column.name),
      [
        "work_id",
        "work_kind",
        "ready_at",
        "accepted_at",
        "started_at",
        "worker_id",
        "fencing_token",
        "lease_expires_at",
      ],
    );
    assert.match(
      String(
        migrated.get(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'codex_execution_queue'",
        )?.sql,
      ),
      /waiver_adjudication/,
    );
  } finally {
    migrated.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

for (const version of [28, 36]) {
  test(`schema v${version} widens the fixed queue before accepting Waiver Adjudications`, () => {
    const directory = mkdtempSync(
      join(tmpdir(), "quality-bar-waiver-migrate-"),
    );
    const databasePath = join(directory, "quality-bar.sqlite");
    const prior = openDurableCore(databasePath);
    prior.transaction((transaction) => {
      transaction.run("DROP INDEX codex_execution_queue_ready");
      transaction.run("DROP INDEX codex_execution_queue_worker");
      transaction.run("DROP TRIGGER codex_execution_queue_identity_update");
      transaction.run("DROP TRIGGER codex_execution_queue_reference_insert");
      transaction.run(
        "DROP TRIGGER codex_execution_queue_waiver_requests_insert",
      );
      transaction.run(
        "DROP TRIGGER codex_execution_queue_waiver_lifecycle_insert",
      );
      transaction.run("DROP TRIGGER codex_execution_queue_waiver_seal_insert");
      transaction.run(
        "DROP TRIGGER codex_execution_queue_waiver_active_delete",
      );
      transaction.run("DROP TRIGGER codex_execution_queue_claim_insert");
      transaction.run("DROP TRIGGER codex_execution_queue_claim_update");
      transaction.run("DROP TRIGGER review_run_queue_reference_delete");
      transaction.run("DROP TABLE waiver_batch_idempotency");
      transaction.run("DROP TABLE waiver_adjudication_requests");
      transaction.run("DROP TABLE waiver_requests");
      transaction.run("DROP TABLE waiver_adjudications");
      transaction.run(
        "ALTER TABLE codex_execution_queue RENAME TO codex_execution_queue_v35",
      );
      transaction.run(
        `CREATE TABLE codex_execution_queue (
         work_id TEXT PRIMARY KEY REFERENCES review_runs(id),
         work_kind TEXT NOT NULL CHECK (work_kind = 'review_run'),
         ready_at INTEGER NOT NULL,
         accepted_at INTEGER NOT NULL,
         started_at INTEGER,
         worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) > 0),
         fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
         lease_expires_at INTEGER,
         CHECK (
           (worker_id IS NULL AND lease_expires_at IS NULL AND fencing_token = 0)
           OR
           (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL
             AND fencing_token > 0)
         ),
         CHECK (started_at IS NULL OR started_at >= accepted_at)
       ) STRICT`,
      );
      transaction.run("DROP TABLE codex_execution_queue_v35");
      transaction.run(
        "UPDATE quality_bar_metadata SET value = ? WHERE key = 'schema_version'",
        String(version),
      );
      transaction.run(`PRAGMA user_version = ${version}`);
    });
    prior.close();

    const migrated = openDurableCore(databasePath);
    try {
      assert.equal(migrated.facts.schemaVersion, 37);
      assert.match(
        String(
          migrated.get(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'codex_execution_queue'",
          )?.sql,
        ),
        /waiver_adjudication/,
      );
      seedCompletedEvaluation(migrated);
      const accepted = createWaiverBatchService(migrated, {
        createAdjudicationId: () => "migrated-adjudication",
        createRequestId: () => "migrated-request",
        now: () => 1_753_800_000_000,
        readCodexCapabilityFailure: () => null,
        storageReserve: { assertWorkAdmissionAvailable() {} },
      }).submit({
        channel: "implementer_token",
        evaluationId: "evaluation-1",
        idempotencyKey: "migrated-key",
        request: {
          requests: [
            {
              finding_id: "finding-1",
              rationale: "This migrated installation needs the exact waiver.",
            },
          ],
        },
      });
      assert.equal(accepted.status, 201);
      assert.deepEqual(
        migrated.get(
          "SELECT work_kind FROM codex_execution_queue WHERE work_id = 'migrated-adjudication'",
        ),
        { work_kind: "waiver_adjudication" },
      );
    } finally {
      migrated.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}
