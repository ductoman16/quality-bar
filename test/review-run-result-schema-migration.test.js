import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("schema v26 migrates queued Review Runs without inventing a partial Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-migrate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  await createQueuedReviewRun(current);
  current.transaction((transaction) => {
    transaction.run("DROP TRIGGER finding_immutable_update");
    transaction.run("DROP TRIGGER finding_immutable_delete");
    transaction.run("DROP TABLE findings");
    transaction.run("DROP TRIGGER evaluation_file_change_immutable_update");
    transaction.run("DROP TRIGGER evaluation_file_change_immutable_delete");
    transaction.run("DROP TABLE evaluation_file_changes");
    transaction.run("DROP TRIGGER criterion_result_immutable_update");
    transaction.run("DROP TRIGGER criterion_result_immutable_delete");
    transaction.run("DROP TABLE criterion_results");
    transaction.run(
      `CREATE TABLE criterion_results (
         review_run_id TEXT NOT NULL REFERENCES review_runs(id),
         criterion_id TEXT NOT NULL REFERENCES criteria(id),
         outcome TEXT NOT NULL CHECK (outcome = 'clear'),
         PRIMARY KEY (review_run_id, criterion_id)
       ) STRICT`,
    );
    transaction.run(
      `CREATE TRIGGER criterion_result_immutable_update
         BEFORE UPDATE ON criterion_results
         BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END`,
    );
    transaction.run(
      `CREATE TRIGGER criterion_result_immutable_delete
         BEFORE DELETE ON criterion_results
         BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END`,
    );
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '26' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 26");
  });
  current.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 30);
  assert.deepEqual(
    migrated.get(
      `SELECT execution_status, started_at, completed_at
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    { completed_at: null, execution_status: "queued", started_at: null },
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
});

test("schema v27 accepts exact not-applicable and error facts without inventing Findings", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-meaning-migrate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  await createQueuedReviewRun(prior);
  prior.transaction((transaction) => {
    transaction.run("DROP TRIGGER finding_immutable_update");
    transaction.run("DROP TRIGGER finding_immutable_delete");
    transaction.run("DROP TABLE findings");
    transaction.run("DROP TRIGGER criterion_result_immutable_update");
    transaction.run("DROP TRIGGER criterion_result_immutable_delete");
    transaction.run("DROP TABLE criterion_results");
    transaction.run(
      `CREATE TABLE criterion_results (
         review_run_id TEXT NOT NULL REFERENCES review_runs(id),
         criterion_id TEXT NOT NULL REFERENCES criteria(id),
         outcome TEXT NOT NULL CHECK (outcome IN ('clear', 'triggered')),
         PRIMARY KEY (review_run_id, criterion_id)
       ) STRICT`,
    );
    transaction.run(
      `CREATE TABLE findings (
         id TEXT PRIMARY KEY,
         evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
         review_run_id TEXT NOT NULL,
         criterion_id TEXT NOT NULL,
         evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
         remediation TEXT NOT NULL CHECK (length(trim(remediation)) > 0),
         location_kind TEXT NOT NULL
           CHECK (location_kind IN ('line_range', 'whole_side', 'changeset')),
         file_change_id TEXT,
         side TEXT CHECK (side IN ('base', 'head')),
         start_line INTEGER CHECK (start_line IS NULL OR start_line > 0),
         end_line INTEGER CHECK (end_line IS NULL OR end_line >= start_line),
         FOREIGN KEY (review_run_id, criterion_id)
           REFERENCES criterion_results(review_run_id, criterion_id),
         FOREIGN KEY (evaluation_id, file_change_id)
           REFERENCES evaluation_file_changes(evaluation_id, id)
       ) STRICT`,
    );
    transaction.run(
      `CREATE TRIGGER criterion_result_immutable_update
         BEFORE UPDATE ON criterion_results
         BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END`,
    );
    transaction.run(
      `CREATE TRIGGER criterion_result_immutable_delete
         BEFORE DELETE ON criterion_results
         BEGIN SELECT RAISE(ABORT, 'criterion_result_immutable'); END`,
    );
    transaction.run(
      `CREATE TRIGGER finding_immutable_update
         BEFORE UPDATE ON findings
         BEGIN SELECT RAISE(ABORT, 'finding_immutable'); END`,
    );
    transaction.run(
      `CREATE TRIGGER finding_immutable_delete
         BEFORE DELETE ON findings
         BEGIN SELECT RAISE(ABORT, 'finding_immutable'); END`,
    );
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '27' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 27");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 30);
  const claims = createReviewRunClaimService(migrated, {
    createWorkerId: () => "migration-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim);
  const criterionId = migrated.get(
    "SELECT criterion_id FROM review_version_criteria",
  )?.criterion_id;
  createReviewRunResultService(migrated, { now: () => 30 }).submit(
    claim,
    {
      criterion_results: [
        {
          criterion_id: criterionId,
          error: {
            code: "required_evidence_unavailable",
            detail: "The required generated file is absent.",
          },
          outcome: "error",
        },
      ],
    },
    [],
  );
  assert.deepEqual(
    migrated.get(
      `SELECT outcome, error_code, error_detail FROM criterion_results`,
    ),
    {
      error_code: "required_evidence_unavailable",
      error_detail: "The required generated file is absent.",
      outcome: "error",
    },
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM findings")?.count,
    0,
  );
});
