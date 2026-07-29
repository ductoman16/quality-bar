import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
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
  assert.equal(migrated.facts.schemaVersion, 27);
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
