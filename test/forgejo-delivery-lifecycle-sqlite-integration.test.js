import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { resumeForgejoDeliveries } from "../src/forgejo-delivery-recovery.js";
import { retireForgejoPublicationRows } from "../src/forgejo-publication-retirement.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";

test("schema v51 preserves legacy waiting, uncertain, and definitive Forgejo delivery state", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-v51-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(path);
  arrangeForgejoFeedback(prior);
  prior.run(
    `INSERT INTO forgejo_finding_feedback (
       finding_id, evaluation_id, publication_status, path, side, line
     ) VALUES (
       'finding-inline', 'evaluation-1', 'waiting',
       'src/example.js', 'RIGHT', 2
     )`,
  );
  prior.run(
    `UPDATE forgejo_feedback_bundles
     SET publication_status = 'unavailable', error_code = 'forgejo_api_unavailable',
         error_detail = 'response lost'`,
  );
  prior.run(
    `UPDATE forgejo_finding_feedback
     SET publication_status = 'unavailable',
         error_code = 'forgejo_repository_permission_denied',
         error_detail = 'permission denied'
     WHERE publication_status = 'waiting'`,
  );
  for (const statement of [
    "DROP TRIGGER forgejo_commit_status_delivery_admit",
    "DROP TRIGGER forgejo_commit_status_delivery_update_admit",
    "DROP TRIGGER forgejo_feedback_bundle_delivery_admit",
    "DROP TRIGGER forgejo_finding_feedback_delivery_admit",
    "DROP TABLE forgejo_delivery_provider_gates",
    "DROP TABLE forgejo_delivery_attempts",
    "UPDATE quality_bar_metadata SET value = '50' WHERE key = 'schema_version'",
    "PRAGMA user_version = 50",
  ]) {
    prior.run(statement);
  }
  prior.close();

  const migrated = openDurableCore(path);
  context.after(() => migrated.close());
  assert.deepEqual(
    migrated.all(
      `SELECT surface, attempt_count, connection_id,
              reconciliation_required, definitive
       FROM forgejo_delivery_attempts
       WHERE surface IN (
         'aggregate_feedback', 'commit_status', 'inline_feedback'
       )
       ORDER BY surface`,
    ),
    [
      {
        attempt_count: 1,
        connection_id: "connection-1",
        definitive: 0,
        reconciliation_required: 1,
        surface: "aggregate_feedback",
      },
      {
        attempt_count: 0,
        connection_id: null,
        definitive: 0,
        reconciliation_required: 0,
        surface: "commit_status",
      },
      {
        attempt_count: 1,
        connection_id: "connection-1",
        definitive: 1,
        reconciliation_required: 0,
        surface: "inline_feedback",
      },
    ],
  );
  assert.equal(
    migrated.get(
      `SELECT count(*) AS count FROM (
         SELECT publication_status FROM forgejo_feedback_bundles
         UNION ALL
         SELECT publication_status FROM forgejo_finding_feedback
         WHERE publication_status != 'aggregate_only'
       ) WHERE publication_status = 'waiting'`,
    )?.count,
    1,
  );
});

test("deliveries admitted after retirement stay stopped until their Repository is verified", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-retired-admit-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core, {
    complete: false,
    connectionLifecycle: "retired",
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  core.run(
    "UPDATE review_runs SET execution_status = 'completed', completed_at = 3 WHERE id = 'run-1'",
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-1', 'blocking', 3)",
  );
  core.run(
    `INSERT INTO forgejo_finding_feedback (
       finding_id, evaluation_id, publication_status, path, side, line,
       error_code, error_detail
     ) VALUES (
       'finding-inline', 'evaluation-1', 'unavailable',
       'src/example.js', 'RIGHT', 2, 'forgejo_connection_retired',
       'Forgejo inline feedback publication is unavailable because the Forgejo Connection is retired'
     )`,
  );

  assert.deepEqual(
    core.all(
      `SELECT surface, connection_id, definitive, error_code
       FROM forgejo_delivery_attempts
       WHERE source_id IN (
         'evaluation-1:failure', 'evaluation-1', 'finding-inline'
       ) ORDER BY surface`,
    ),
    [
      {
        connection_id: "connection-1",
        definitive: 1,
        error_code: "forgejo_connection_retired",
        surface: "aggregate_feedback",
      },
      {
        connection_id: "connection-1",
        definitive: 1,
        error_code: "forgejo_connection_retired",
        surface: "commit_status",
      },
      {
        connection_id: "connection-1",
        definitive: 1,
        error_code: "forgejo_connection_retired",
        surface: "inline_feedback",
      },
    ],
  );
  core.run(
    "UPDATE forgejo_connections SET lifecycle = 'enabled', verified_at = 10",
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM forgejo_delivery_attempts WHERE definitive = 1",
    )?.count,
    3,
  );
  core.transaction((transaction) => {
    transaction.run("UPDATE repositories SET lifecycle = 'enabled'");
    resumeForgejoDeliveries(
      transaction,
      "connection-1",
      11,
      "repository_authority",
      [101],
    );
  });
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM forgejo_delivery_attempts WHERE definitive = 1",
    )?.count,
    0,
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count FROM (
         SELECT publication_status FROM forgejo_commit_statuses
          WHERE evaluation_id = 'evaluation-1'
         UNION ALL SELECT publication_status FROM forgejo_feedback_bundles
         UNION ALL SELECT publication_status FROM forgejo_finding_feedback
       ) WHERE publication_status = 'waiting'`,
    )?.count,
    3,
  );
});

test("retirement preserves already successful delivery state", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-retire-success-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  core.transaction((transaction) => {
    transaction.run(
      `UPDATE forgejo_delivery_attempts
       SET connection_id = 'connection-1', authority_verified_at = 1,
           attempt_count = 1, last_attempt_at = 4, external_id = 701
       WHERE surface = 'commit_status'`,
    );
    transaction.run(
      `UPDATE forgejo_commit_statuses
       SET publication_status = 'succeeded', published_state = desired_state,
           published_at = 4, external_id = 701`,
    );
    retireForgejoPublicationRows(transaction, "connection-1");
  });
  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id FROM forgejo_commit_statuses",
    ),
    { external_id: 701, publication_status: "succeeded" },
  );
  assert.deepEqual(
    core.get(
      `SELECT definitive, error_code, external_id
       FROM forgejo_delivery_attempts WHERE surface = 'commit_status'`,
    ),
    { definitive: 0, error_code: null, external_id: 701 },
  );
});
