import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { readForgejoConnection } from "../src/forgejo-connection-read.js";
import {
  attemptForgejoDelivery,
  recordForgejoDeliveryHealth,
} from "../src/forgejo-delivery-service.js";
import { resumeForgejoDeliveries } from "../src/forgejo-delivery-recovery.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";

test("a definitive delivery identity conflict does not misdiagnose connection health", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-identity-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);

  await attemptForgejoDelivery(core, {
    connectionId: "connection-1",
    create: async () => 901,
    now: () => 10,
    onDefinitive: (transaction, failure, attemptedAt) => {
      transaction.run(
        `UPDATE forgejo_commit_statuses
         SET publication_status = 'unavailable', error_code = ?,
             error_detail = ?`,
        failure.code,
        failure.detail,
      );
      recordForgejoDeliveryHealth(
        transaction,
        "connection-1",
        attemptedAt,
        failure,
      );
    },
    onSuccess() {},
    reconcile: async () => {
      throw Object.assign(new Error("duplicate source identities"), {
        code: "forgejo_delivery_identity_conflict",
      });
    },
    sourceId: "evaluation-1:blocking",
    surface: "commit_status",
    target: '{"state":"blocking"}',
  });
  core.run(
    `UPDATE forgejo_delivery_attempts
     SET reconciliation_required = 1, external_id = NULL,
         next_attempt_at = 0, generation = 0, attempt_count = 0,
         last_attempt_at = NULL, connection_id = NULL,
         authority_verified_at = NULL
     WHERE surface = 'commit_status'`,
  );
  await attemptForgejoDelivery(core, {
    connectionId: "connection-1",
    create: async () => 901,
    now: () => 20,
    onDefinitive: (transaction, failure, attemptedAt) => {
      recordForgejoDeliveryHealth(
        transaction,
        "connection-1",
        attemptedAt,
        failure,
      );
    },
    onSuccess() {},
    reconcile: async () => {
      throw Object.assign(new Error("duplicate source identities"), {
        code: "forgejo_delivery_identity_conflict",
      });
    },
    sourceId: "evaluation-1:blocking",
    surface: "commit_status",
    target: '{"state":"blocking"}',
  });

  assert.equal(
    core.get(
      "SELECT health FROM forgejo_connections WHERE id = ?",
      "connection-1",
    )?.health,
    "healthy",
  );
});

test("corrected Forgejo authority visibly resumes definitive delivery without changing Evaluation truth", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-resume-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  core.run(
    `INSERT INTO forgejo_finding_feedback (
       finding_id, evaluation_id, publication_status, path, side, line
     ) VALUES (
       'finding-inline', 'evaluation-1', 'waiting',
       'src/example.js', 'RIGHT', 2
     )`,
  );
  core.run(
    `UPDATE forgejo_commit_statuses
     SET publication_status = 'unavailable',
         error_code = 'forgejo_connection_credential_invalid',
         error_detail = 'Forgejo PAT rejected'`,
  );
  core.run(
    `UPDATE forgejo_feedback_bundles
     SET publication_status = 'unavailable',
         error_code = 'forgejo_repository_permission_denied',
         error_detail = 'Forgejo Repository permission denied'`,
  );
  core.run(
    `UPDATE forgejo_finding_feedback
     SET publication_status = 'unavailable',
         error_code = 'forgejo_delivery_identity_conflict',
         error_detail = 'duplicate source identities'
     WHERE publication_status = 'waiting'`,
  );
  core.run(
    `UPDATE forgejo_delivery_attempts
     SET connection_id = 'connection-1', authority_verified_at = 1,
         attempt_count = 1, last_attempt_at = 10,
         reconciliation_required = 1, definitive = 1,
         response_status = 401,
         error_code = 'forgejo_connection_credential_invalid',
         error_detail = 'Forgejo PAT rejected'
     WHERE surface = 'commit_status'`,
  );
  core.run(
    `UPDATE forgejo_delivery_attempts
     SET connection_id = 'connection-1', authority_verified_at = 1,
         attempt_count = 1, last_attempt_at = 10,
         reconciliation_required = 1, definitive = 1,
         response_status = 403,
         error_code = CASE surface
           WHEN 'aggregate_feedback' THEN 'forgejo_repository_permission_denied'
           ELSE 'forgejo_delivery_identity_conflict'
         END,
         error_detail = CASE surface
           WHEN 'aggregate_feedback' THEN 'Forgejo Repository permission denied'
           ELSE 'duplicate source identities'
         END
     WHERE surface IN ('aggregate_feedback', 'inline_feedback')`,
  );
  core.run(
    `INSERT INTO forgejo_delivery_provider_gates
       (connection_id, gate_until, error_code, error_detail)
     VALUES ('connection-1', 3_600_000, 'forgejo_api_rate_limited', 'rate')`,
  );

  core.transaction((transaction) =>
    resumeForgejoDeliveries(
      transaction,
      "connection-1",
      20,
      "connection_authority",
    ),
  );

  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_commit_statuses`,
    ),
    { error_code: null, error_detail: null, publication_status: "waiting" },
  );
  assert.deepEqual(
    core.all(
      `SELECT publication_status, error_code
       FROM forgejo_feedback_bundles
       UNION ALL
       SELECT publication_status, error_code
       FROM forgejo_finding_feedback
       WHERE publication_status != 'aggregate_only'`,
    ),
    [
      { error_code: null, publication_status: "waiting" },
      {
        error_code: "forgejo_delivery_identity_conflict",
        publication_status: "unavailable",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT definitive, error_code, next_attempt_at,
              reconciliation_required
       FROM forgejo_delivery_attempts
       WHERE surface = 'commit_status'
         AND source_id = (
           SELECT evaluation_id || ':' || desired_state
           FROM forgejo_commit_statuses
         )`,
    ),
    {
      definitive: 0,
      error_code: null,
      next_attempt_at: 20,
      reconciliation_required: 1,
    },
  );
  assert.equal(
    core.get("SELECT outcome FROM evaluation_results")?.outcome,
    "blocking",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_delivery_provider_gates")
      ?.count,
    1,
  );
});

test("schema v51 resumes legacy uncertain Forgejo feedback without violating immutability", (context) => {
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
     SET publication_status = 'unavailable', error_code = 'forgejo_api_unavailable',
         error_detail = 'response lost'
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
      `SELECT surface, reconciliation_required, definitive
       FROM forgejo_delivery_attempts
       WHERE surface IN ('aggregate_feedback', 'inline_feedback')
       ORDER BY surface`,
    ),
    [
      {
        definitive: 0,
        reconciliation_required: 1,
        surface: "aggregate_feedback",
      },
      {
        definitive: 0,
        reconciliation_required: 1,
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
    2,
  );
});

test("delivery failure health remains exact and scoped to its owning Forgejo resource", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-health-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-2', 'https://forgejo.example/operator/sibling.git', 1, 1)",
  );
  core.run(
    `INSERT INTO forgejo_repositories (
       repository_id, connection_id, verification_id, forge_repository_id,
       name, api_url, web_url
     ) VALUES (
       'repository-2', 'connection-1', 'verification-1', 102,
       'operator/sibling', 'https://forgejo.example/api/v1/repos/operator/sibling',
       'https://forgejo.example/operator/sibling'
     )`,
  );
  core.transaction((transaction) =>
    recordForgejoDeliveryHealth(transaction, "connection-1", 20, {
      code: "forgejo_repository_permission_denied",
      definitive: true,
      detail: "Forgejo Repository permission denied",
      repositoryId: 101,
      responseStatus: 403,
    }),
  );
  assert.deepEqual(
    core.all("SELECT id, health FROM repositories ORDER BY id"),
    [
      { health: "error", id: "repository-1" },
      { health: "healthy", id: "repository-2" },
    ],
  );
  await attemptForgejoDelivery(core, {
    connectionId: "connection-1",
    create: async () => 990,
    now: () => 21,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async () => null,
    sourceId: "sibling-delivery",
    surface: "aggregate_feedback",
    target: '{"repository_id":102}',
  });
  assert.equal(
    core.get(
      `SELECT external_id FROM forgejo_delivery_attempts
       WHERE source_id = 'sibling-delivery'`,
    )?.external_id,
    990,
  );
  core.run(
    "DELETE FROM forgejo_repositories WHERE repository_id = 'repository-2'",
  );
  core.run("DELETE FROM repositories WHERE id = 'repository-2'");

  core.run(
    `UPDATE forgejo_delivery_attempts
     SET connection_id = 'connection-1', authority_verified_at = 1,
         attempt_count = 1, last_attempt_at = 20, definitive = 1,
         error_code = 'forgejo_connection_credential_invalid',
         error_detail = 'Forgejo PAT rejected'
     WHERE surface = 'commit_status'`,
  );
  core.run("UPDATE forgejo_connections SET health = 'error'");
  assert.deepEqual(readForgejoConnection(core)?.health_error, {
    code: "forgejo_connection_credential_invalid",
    message: "Forgejo PAT rejected",
  });
  core.transaction((transaction) => {
    transaction.run("UPDATE forgejo_connections SET health = 'healthy'");
    resumeForgejoDeliveries(
      transaction,
      "connection-1",
      30,
      "connection_authority",
    );
  });
  assert.deepEqual(
    core.get(
      `SELECT definitive, error_code FROM forgejo_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    { definitive: 0, error_code: null },
  );
  assert.equal(
    core.get("SELECT health FROM forgejo_connections")?.health,
    "healthy",
  );
  assert.equal(readForgejoConnection(core)?.health_error, null);
});
