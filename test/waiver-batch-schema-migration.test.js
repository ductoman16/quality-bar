import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicationClaimService } from "../src/waiver-adjudication-claim.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("deployed schema v39 preserves GitHub feedback and queued Waiver Adjudication work", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-v39-migrate-"),
  );
  const databasePath = join(directory, "quality-bar.sqlite");
  const prior = openDurableCore(databasePath);
  seedCompletedEvaluation(prior);
  createWaiverBatchService(prior, {
    createAdjudicationId: () => "queued-adjudication",
    createRequestId: () => "queued-request",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "implementer_token",
    evaluationId: "evaluation-1",
    idempotencyKey: "queued-waiver",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "The exact deployed request must remain claimable.",
        },
      ],
    },
  });
  prior.close();

  const deployed = new DatabaseSync(databasePath);
  deployed.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TRIGGER codex_execution_queue_reference_insert;
    DROP TRIGGER codex_execution_queue_waiver_requests_insert;
    DROP TRIGGER codex_execution_queue_waiver_lifecycle_insert;
    DROP TRIGGER codex_execution_queue_waiver_seal_insert;
    DROP TRIGGER codex_execution_queue_waiver_active_delete;
    DROP TRIGGER waiver_adjudication_request_evaluation_insert;
    DROP TRIGGER waiver_adjudication_request_set_frozen_insert;
    DROP TABLE waiver_adjudication_transcript_chunks;
    DROP TABLE waiver_decisions;
    CREATE TABLE waiver_adjudications_v39 (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL,
      service_tier TEXT NOT NULL,
      execution_status TEXT NOT NULL CHECK (
        execution_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
      ),
      requests_sealed_at INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      CHECK (length(base_commit) = length(head_commit)),
      CHECK (requests_sealed_at IS NULL OR requests_sealed_at >= created_at)
    ) STRICT;
    INSERT INTO waiver_adjudications_v39 (
      id, evaluation_id, base_commit, head_commit, model, reasoning_effort,
      service_tier, execution_status, requests_sealed_at, created_at,
      started_at, completed_at
    )
    SELECT id, evaluation_id, base_commit, head_commit, model,
           reasoning_effort, service_tier, execution_status,
           requests_sealed_at, created_at, started_at, completed_at
    FROM waiver_adjudications;
    DROP TABLE waiver_adjudications;
    ALTER TABLE waiver_adjudications_v39 RENAME TO waiver_adjudications;
    UPDATE quality_bar_metadata
    SET value = '39' WHERE key = 'schema_version';
    PRAGMA user_version = 39;
    COMMIT;
  `);
  deployed.close();

  const migrated = openDurableCore(databasePath);
  try {
    assert.equal(migrated.facts.schemaVersion, 41);
    assert.ok(
      migrated.get(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'github_finding_feedback'",
      ),
    );
    assert.deepEqual(
      migrated
        .all("PRAGMA table_info(waiver_adjudications)")
        .slice(-9)
        .map((/** @type {any} */ column) => column.name),
      [
        "error_code",
        "error_detail",
        "codex_cli_version",
        "process_exit_code",
        "process_signal",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "execution_evidence_recorded",
      ],
    );
    const claim = createWaiverAdjudicationClaimService(migrated, {
      createWorkerId: () => "v39-upgrade-worker",
      now: () => 20,
    }).claimNext();
    assert.deepEqual(claim, {
      fencingToken: 1,
      leaseExpiresAt: 120_020,
      workerId: "v39-upgrade-worker",
      workId: "queued-adjudication",
    });
  } finally {
    migrated.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

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
    transaction.run("DROP TABLE waiver_adjudication_transcript_chunks");
    transaction.run("DROP TABLE waiver_decisions");
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
    assert.equal(migrated.facts.schemaVersion, 41);
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

for (const version of [28, 36, 37]) {
  test(`schema v${version} widens the fixed queue before accepting Waiver Adjudications`, () => {
    const directory = mkdtempSync(
      join(tmpdir(), "quality-bar-waiver-migrate-"),
    );
    const databasePath = join(directory, "quality-bar.sqlite");
    const prior = openDurableCore(databasePath);
    if (version === 37) {
      seedCompletedEvaluation(prior);
      prior.run(
        `INSERT INTO github_connections (
           id, app_id, app_slug, installation_id,
           principal_id, principal_login, api_profile,
           permissions, capabilities, repository_count,
           created_at, verified_at
         ) VALUES (
           'connection-1', 47, 'quality-bar', 73,
           91, 'operator', 'github-rest:2026-03-10',
           '{}', '{}', 1, 1, 1
         )`,
      );
      prior.run(
        `INSERT INTO github_connection_verifications (
           id, connection_id, trigger, outcome, api_profile,
           principal_id, principal_login, permissions, capabilities,
           affected_repository_ids, repository_checks, repositories,
           verified_at
         ) VALUES (
           'verification-1', 'connection-1', 'onboarding', 'success',
           'github-rest:2026-03-10', 91, 'operator', '{}', '{}',
           '[101]', '[{"repository_id":101,"outcome":"success"}]',
           '[{"api_url":"https://api.github.com/repos/operator/repository","clone_url":"https://github.com/operator/repository.git","full_name":"operator/repository","html_url":"https://github.com/operator/repository","id":101,"private":true}]',
           1
         )`,
      );
      prior.run(
        `INSERT INTO github_repositories (
           repository_id, connection_id, verification_id,
           forge_repository_id, name, api_url, web_url
         ) VALUES (
           'repository-1', 'connection-1', 'verification-1',
           101, 'operator/repository',
           'https://api.github.com/repos/operator/repository',
           'https://github.com/operator/repository'
         )`,
      );
      prior.run(
        `INSERT INTO github_commit_statuses (
           repository_id, head_commit, evaluation_id,
           desired_state, publication_status, published_state, published_at
         ) VALUES (
           'repository-1', ?, 'evaluation-1',
           'failure', 'succeeded', 'failure', 3
         )`,
        "b".repeat(40),
      );
    }
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
      transaction.run("DROP TABLE waiver_adjudication_transcript_chunks");
      transaction.run("DROP TABLE waiver_decisions");
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
      assert.equal(migrated.facts.schemaVersion, 41);
      assert.match(
        String(
          migrated.get(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'codex_execution_queue'",
          )?.sql,
        ),
        /waiver_adjudication/,
      );
      if (version === 37) {
        assert.deepEqual(
          migrated.get(
            `SELECT evaluation_id, desired_state, publication_status,
                    published_state, published_at
             FROM github_commit_statuses
             WHERE repository_id = 'repository-1'`,
          ),
          {
            desired_state: "failure",
            evaluation_id: "evaluation-1",
            publication_status: "succeeded",
            published_at: 3,
            published_state: "failure",
          },
        );
      } else {
        seedCompletedEvaluation(migrated);
      }
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
