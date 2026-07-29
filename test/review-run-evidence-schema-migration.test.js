import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("schema v30 history migrates without invented Review Run evidence", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-v30-evidence-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  await createQueuedReviewRun(prior);
  const claims = createReviewRunClaimService(prior, {
    createWorkerId: () => "v30-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  const criterionId = prior.get(
    "SELECT criterion_id FROM review_version_criteria",
  )?.criterion_id;
  const results = createReviewRunResultService(prior, { now: () => 30 });
  results.prepare(
    claim,
    {
      criterion_results: [{ criterion_id: criterionId, outcome: "clear" }],
    },
    [],
  );
  prior.transaction((transaction) => {
    transaction.run("DROP TRIGGER review_run_cli_version_immutable");
    transaction.run("DROP TRIGGER review_run_execution_evidence_immutable");
    transaction.run(
      "DROP TRIGGER review_run_transcript_chunk_immutable_update",
    );
    transaction.run(
      "DROP TRIGGER review_run_transcript_chunk_immutable_delete",
    );
    transaction.run(
      "DROP TRIGGER review_run_transcript_chunk_requires_started_run",
    );
    transaction.run("DROP TABLE review_run_transcript_chunks");
    for (const column of [
      "codex_cli_version",
      "process_exit_code",
      "process_signal",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "execution_evidence_recorded",
    ]) {
      transaction.run(`ALTER TABLE review_runs DROP COLUMN ${column}`);
    }
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '30' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 30");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 31);
  assert.deepEqual(
    migrated.get(
      `SELECT execution_status, started_at, completed_at,
              codex_cli_version, process_exit_code, process_signal,
              input_tokens, cached_input_tokens, output_tokens,
              execution_evidence_recorded
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      cached_input_tokens: null,
      codex_cli_version: null,
      completed_at: 30,
      execution_evidence_recorded: 0,
      execution_status: "completed",
      input_tokens: null,
      output_tokens: null,
      process_exit_code: null,
      process_signal: null,
      started_at: 20,
    },
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM criterion_results")?.count,
    1,
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM review_run_transcript_chunks")
      ?.count,
    0,
  );
});
