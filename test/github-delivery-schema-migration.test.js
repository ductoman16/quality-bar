import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { arrangeGitHubFeedback as arrange } from "./github-feedback-publication-support.js";

test("schema 40 preserves successful identities and reconciles uncertain delivery history", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-v40-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  arrange(prior);
  prior.run(
    `UPDATE github_commit_statuses
     SET publication_status = 'succeeded',
         published_state = desired_state,
         published_at = 10`,
  );
  prior.run(
    `UPDATE github_feedback_bundles
     SET publication_status = 'succeeded',
         external_id = 701,
         published_at = 11`,
  );
  prior.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, error_code, error_detail
     ) VALUES (
       'finding-inline', 'evaluation-1', 'unavailable',
       'src/example.js', 'RIGHT', 1,
       'github_api_unavailable',
       'GitHub API request could not complete'
     )`,
  );
  prior.transaction((transaction) => {
    for (const trigger of [
      "github_commit_status_delivery_admit",
      "github_commit_status_delivery_update_admit",
      "github_feedback_bundle_delivery_admit",
      "github_finding_feedback_delivery_admit",
    ]) {
      transaction.run(`DROP TRIGGER ${trigger}`);
    }
    transaction.run("DROP TABLE github_delivery_provider_gates");
    transaction.run("DROP TABLE github_delivery_attempts");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '40' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 40");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 41);
  assert.deepEqual(
    migrated.all(
      `SELECT surface, source_id, attempt_count, last_attempt_at,
              reconciliation_required, external_id, error_code, definitive
       FROM github_delivery_attempts
       ORDER BY surface, source_id`,
    ),
    [
      {
        attempt_count: 1,
        definitive: 0,
        error_code: null,
        external_id: 701,
        last_attempt_at: 11,
        reconciliation_required: 0,
        source_id: "evaluation-1",
        surface: "aggregate_feedback",
      },
      {
        attempt_count: 1,
        definitive: 0,
        error_code: null,
        external_id: null,
        last_attempt_at: 10,
        reconciliation_required: 0,
        source_id: "evaluation-1:failure",
        surface: "commit_status",
      },
      {
        attempt_count: 0,
        definitive: 0,
        error_code: "github_api_unavailable",
        external_id: null,
        last_attempt_at: null,
        reconciliation_required: 1,
        source_id: "finding-inline",
        surface: "inline_feedback",
      },
    ],
  );
  assert.deepEqual(
    migrated.get(
      `SELECT publication_status, error_code, error_detail
       FROM github_finding_feedback
       WHERE finding_id = 'finding-inline'`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "waiting",
    },
  );
});
