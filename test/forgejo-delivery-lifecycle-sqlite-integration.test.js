import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { resumeForgejoDeliveries } from "../src/forgejo/forgejo-delivery-recovery.js";
import { retireForgejoPublicationRows } from "../src/forgejo/forgejo-publication-retirement.js";
import { createRepositoryService, RepositoryError } from "../src/repository/repository.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";

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
  core.run(
    `INSERT INTO forgejo_delivery_provider_gates
       (connection_id, gate_until, error_code, error_detail)
     VALUES ('connection-1', 3_600_000,
             'forgejo_api_rate_limited', 'Forgejo rate limit is active')`,
  );
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
  assert.equal(
    core.get("SELECT gate_until FROM forgejo_delivery_provider_gates")
      ?.gate_until,
    3_600_000,
  );
});

test("Repository admission prefers current polling failure over stale verification history", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-current-health-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, profile, reported_version, principal,
       scopes, capabilities, repositories, error_code, error_message,
       verified_at
     ) VALUES (
       'verification-old-failure', 'connection-1', 'manual_test',
       NULL, NULL, NULL, NULL, NULL, NULL,
       'forgejo_connection_credential_invalid', 'old PAT failure', 2
     )`,
  );
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, profile, reported_version, principal,
       scopes, capabilities, repositories, error_code, error_message,
       verified_at
     )
     SELECT 'verification-current', connection_id, 'manual_test', profile,
            reported_version, principal, scopes, capabilities, repositories,
            NULL, NULL, 3
     FROM forgejo_connection_verifications WHERE id = 'verification-1'`,
  );
  core.run("UPDATE forgejo_connections SET health = 'error', verified_at = 3");
  core.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (
       'forgejo_poll_gate:connection-1',
       '{"code":"forgejo_poll_unavailable","message":"current polling failure","next_attempt_at":60000}'
     )`,
  );
  const repositories = createRepositoryService(core, {
    createId: () => "unused",
    masterKey: Buffer.alloc(32, 4),
    now: () => 4,
    async verifyRead() {},
  });
  context.after(() => repositories.destroy());
  assert.throws(
    () => repositories.requireAcceptsNewWork("repository-1"),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "forgejo_poll_unavailable" &&
      error.message === "current polling failure",
  );
});
