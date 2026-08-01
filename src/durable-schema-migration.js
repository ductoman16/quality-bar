import { validateIntegrity } from "./durable-integrity.js";
import { currentGitHubConnectionRotationMigration } from "./github-connection-schema-migration.js";

export const EXPECTED_SCHEMA_TABLES = new Set(
  "applicability_results,applicability_selections,application_logs,authority_attributions,browser_sessions,codex_execution_pre_start_attempts,codex_execution_queue,codex_execution_settings,criteria,criterion_results,evaluation_file_changes,evaluation_idempotency,evaluation_pre_start_retries,evaluation_results,evaluations,findings,forgejo_automatic_evaluation_pull_requests,forgejo_automatic_evaluations,forgejo_connection_credentials,forgejo_connection_verifications,forgejo_connections,forgejo_repositories,forgejo_repository_polls,github_automatic_evaluation_pull_requests,github_automatic_evaluations,github_commit_statuses,github_connection_credentials,github_connection_verifications,github_connections,github_delivery_attempts,github_delivery_provider_gates,github_feedback_bundles,github_finding_feedback,github_repositories,github_repository_polls,quality_bar_metadata,repositories,repository_credentials,review_assignment_repositories,review_assignments,review_run_pre_start_attempts,review_run_transcript_chunks,review_runs,review_version_criteria,review_versions,reviews,waiver_adjudication_pre_start_attempts,waiver_adjudication_requests,waiver_adjudication_transcript_chunks,waiver_adjudications,waiver_adjudicator_configuration,waiver_batch_idempotency,waiver_decisions,waiver_recovery_idempotency,waiver_requests".split(
    ",",
  ),
);

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {string} statements
 * @param {number} schemaVersion
 */
export function migrateSchema(
  database,
  statements,
  schemaVersion = CURRENT_SCHEMA_VERSION,
) {
  const reviewRunEvidenceStatements = statements.includes(
    "DROP TABLE review_runs",
  )
    ? ""
    : reviewRunEvidenceMigration(database);
  const repositoryHasUsageMarker = database
    .prepare("PRAGMA table_info(repositories)")
    .all()
    .some((column) => column.name === "has_been_used");
  const migrationCreatesUsageMarker = statements.includes("has_been_used");
  const reviewHasDeletionMarker = database
    .prepare("PRAGMA table_info(reviews)")
    .all()
    .some((column) => column.name === "hard_delete_pending");
  const migrationCreatesDeletionMarker = statements.includes(
    "hard_delete_pending",
  );
  const fileChangeTableExists = Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'evaluation_file_changes'",
      )
      .all().length,
  );
  const fileChangeHasKinds =
    fileChangeTableExists &&
    database
      .prepare("PRAGMA table_info(evaluation_file_changes)")
      .all()
      .some((column) => column.name === "added");
  const evaluationCancellationStatements =
    evaluationCancellationMigration(database);
  const waiverAdjudicationStatements =
    waiverAdjudicationExecutionMigration(database);
  const waiverAdjudicationRecoveryStatements =
    waiverAdjudicationRecoveryMigration(database);
  const reviewRunPreStartStatements = reviewRunPreStartMigration(
    database,
    statements,
  );
  const queueSchema = database
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'codex_execution_queue'",
    )
    .all()[0]?.sql;
  const queueColumns =
    typeof queueSchema === "string"
      ? new Set(
          database
            .prepare("PRAGMA table_info(codex_execution_queue)")
            .all()
            .map((column) => column.name),
        )
      : new Set();
  const queueNeedsWaiverKind =
    schemaVersion === CURRENT_SCHEMA_VERSION &&
    typeof queueSchema === "string" &&
    !queueSchema.includes("waiver_adjudication");
  const queueNeedsClaimColumns =
    queueNeedsWaiverKind &&
    !queueColumns.has("worker_id") &&
    !statements.includes("ADD COLUMN worker_id");
  const queueNeedsRetryState =
    schemaVersion === CURRENT_SCHEMA_VERSION &&
    typeof queueSchema === "string" &&
    !queueColumns.has("retry_state") &&
    !statements.includes("ADD COLUMN retry_state");
  const queueNeedsProcessGroup =
    schemaVersion === CURRENT_SCHEMA_VERSION &&
    typeof queueSchema === "string" &&
    !queueColumns.has("process_group_id") &&
    !statements.includes("ADD COLUMN process_group_id");
  const githubRotationMigration = currentGitHubConnectionRotationMigration(
    database,
    schemaVersion,
    CURRENT_SCHEMA_VERSION,
  );
  // prettier-ignore
  const rotationPragmas = githubRotationMigration ? [database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, database.prepare("PRAGMA legacy_alter_table").get()?.legacy_alter_table] : [];
  if (githubRotationMigration) {
    database.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;");
  }
  database.function(
    "quality_bar_legacy_file_change_modified",
    { deterministic: true },
    legacyFileChangeModified,
  );
  database.function(
    "quality_bar_legacy_file_change_paths_valid",
    { deterministic: true },
    legacyFileChangePathsValid,
  );
  let migrationOpen = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    migrationOpen = true;
    database.exec(`
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `DROP TRIGGER IF EXISTS review_run_queue_reference_delete;
           DROP TRIGGER IF EXISTS waiver_adjudication_queue_reference_delete;
           DROP TRIGGER IF EXISTS github_finding_feedback_insert;`
        : ""
    }
    ${statements}
    ${githubRotationMigration}
    ${
      queueNeedsClaimColumns
        ? `ALTER TABLE codex_execution_queue
             ADD COLUMN worker_id TEXT
             CHECK (worker_id IS NULL OR length(worker_id) > 0);
           ALTER TABLE codex_execution_queue
             ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0
             CHECK (fencing_token >= 0);
           ALTER TABLE codex_execution_queue
             ADD COLUMN lease_expires_at INTEGER;`
        : ""
    }
    ${
      queueNeedsRetryState
        ? `ALTER TABLE codex_execution_queue
             ADD COLUMN retry_state TEXT NOT NULL DEFAULT 'ready'
             CHECK (retry_state IN ('ready', 'exhausted'));`
        : ""
    }
    ${queueNeedsWaiverKind ? WAIVER_QUEUE_MIGRATION : ""}
    ${
      queueNeedsProcessGroup
        ? `ALTER TABLE codex_execution_queue
             ADD COLUMN process_group_id INTEGER
             CHECK (process_group_id IS NULL OR process_group_id > 0);
           ALTER TABLE codex_execution_queue
             ADD COLUMN process_group_recorded_at INTEGER;
           ALTER TABLE codex_execution_queue
             ADD COLUMN process_boot_identity TEXT;
           ALTER TABLE codex_execution_queue
             ADD COLUMN process_namespace_identity TEXT;
           ALTER TABLE codex_execution_queue
             ADD COLUMN process_start_identity TEXT;
           ALTER TABLE codex_execution_queue
             ADD COLUMN process_group_finished_at INTEGER;
           ALTER TABLE codex_execution_queue
             ADD COLUMN recovery_termination_signal TEXT CHECK (
               recovery_termination_signal IS NULL
               OR recovery_termination_signal IN ('SIGTERM', 'SIGKILL')
             );
           ALTER TABLE codex_execution_queue
             ADD COLUMN recovered_at INTEGER;`
        : ""
    }
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `${HOST_ATTRIBUTION_MIGRATION}${FORGEJO_CONNECTION_SCHEMA}${FORGEJO_POLLING_MIGRATION}${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}${reviewRunEvidenceStatements}${fileChangeTableExists && !fileChangeHasKinds ? EVALUATION_FILE_CHANGE_KIND_MIGRATION : ""}${evaluationCancellationStatements}${waiverAdjudicationStatements}${retrySummaryColumnMigration(database)}${RETENTION_SCHEMA}${EVALUATION_SCHEMA}${WAIVER_BATCH_SCHEMA}${waiverAdjudicationRecoveryStatements}${reviewRunPreStartStatements}${repositoryHasUsageMarker || migrationCreatesUsageMarker ? "" : REPOSITORY_USAGE_MIGRATION}${REPOSITORY_USAGE_INTEGRITY}${reviewHasDeletionMarker || migrationCreatesDeletionMarker ? "" : REVIEW_DELETION_COLUMN_MIGRATION}${REVIEW_DELETION_INTEGRITY}${GITHUB_FEEDBACK_SCHEMA}${RETENTION_BACKFILL}`
        : ""
    }
    UPDATE quality_bar_metadata
    SET value = '${schemaVersion}'
    WHERE key = 'schema_version';
    PRAGMA user_version = ${schemaVersion};
  `);
    validateResultingSchema(database, schemaVersion);
    database.exec("COMMIT");
    migrationOpen = false;
  } catch (error) {
    if (migrationOpen) {
      try {
        database.exec("ROLLBACK");
      } catch (rollbackError) {
        if (error instanceof Error) {
          error.cause = new AggregateError(
            [error.cause ?? error, rollbackError],
            "SQLite migration and rollback both failed",
          );
        }
      }
    }
    throw error;
  } finally {
    if (githubRotationMigration) {
      // prettier-ignore
      database.exec(`PRAGMA foreign_keys = ${rotationPragmas[0] ? "ON" : "OFF"}; PRAGMA legacy_alter_table = ${rotationPragmas[1] ? "ON" : "OFF"};`);
    }
  }
}
export function finalizeSchemaMigration(
  /** @type {import("node:sqlite").DatabaseSync} */ database,
  /** @type {number} */ version,
) {
  if (
    ![
      29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
      47, 48,
    ].includes(version)
  ) {
    fail("schema_invalid", `SQLite schema version ${version} is not supported`);
  }
  if (version === 35) {
    migrateEvaluationCancellationReason(database, migrateSchema);
    return;
  }
  if (version === 47) {
    migrateSchema(database, "", CURRENT_SCHEMA_VERSION);
    return;
  }
  if (
    version === 44 &&
    database
      .prepare(
        `SELECT 1
         FROM codex_execution_queue
         WHERE started_at IS NOT NULL
         LIMIT 1`,
      )
      .get()
  ) {
    fail(
      "codex_execution_process_identity_unavailable",
      "Legacy started Codex execution process identity is unavailable",
    );
  }
  const hasApplicabilitySeal = database
    .prepare("PRAGMA table_info(evaluations)")
    .all()
    .some((column) => column.name === "applicability_sealed_at");
  migrateSchema(
    database,
    `${
      hasApplicabilitySeal
        ? ""
        : "ALTER TABLE evaluations ADD COLUMN applicability_sealed_at INTEGER;"
    }
    ${version === 40 || version === 41 ? WAIVER_REQUEST_LIFECYCLE_MIGRATION_VALIDATION : ""}
    UPDATE evaluations
    SET applicability_sealed_at = created_at
    WHERE applicability_sealed_at IS NULL;`,
  );
}
export const CURRENT_SCHEMA_VERSION = 49;
import { FORGEJO_CONNECTION_SCHEMA } from "./forgejo-connection-schema.js";
import { FORGEJO_POLLING_MIGRATION } from "./forgejo-polling-schema.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import { migrateEvaluationCancellationReason } from "./evaluation-cancellation-reason-migration.js";
import {
  EVALUATION_FILE_CHANGE_KIND_MIGRATION,
  EVALUATION_SCHEMA,
  evaluationCancellationMigration,
} from "./evaluation-schema.js";
import {
  legacyFileChangeModified,
  legacyFileChangePathsValid,
} from "./evaluation-file-change-schema.js";
import {
  REPOSITORY_USAGE_INTEGRITY,
  REPOSITORY_USAGE_MIGRATION,
} from "./repository-schema.js";
import {
  REVIEW_DELETION_COLUMN_MIGRATION,
  REVIEW_DELETION_INTEGRITY,
} from "./review-deletion-schema.js";
import { reviewRunEvidenceMigration } from "./review-run-evidence.js";
import { GITHUB_FEEDBACK_SCHEMA } from "./github-feedback-schema.js";
import {
  WAIVER_BATCH_SCHEMA,
  WAIVER_QUEUE_MIGRATION,
} from "./waiver-batch-schema.js";
import { WAIVER_REQUEST_LIFECYCLE_MIGRATION_VALIDATION } from "./waiver-request-lifecycle-schema-migration.js";
import { waiverAdjudicationExecutionMigration } from "./waiver-adjudication-schema-migration.js";
import { waiverAdjudicationRecoveryMigration } from "./waiver-adjudication-recovery-schema.js";
import { reviewRunPreStartMigration } from "./review-run-pre-start-schema.js";
import {
  RETENTION_BACKFILL,
  RETENTION_SCHEMA,
  retrySummaryColumnMigration,
} from "./retention-schema.js";
export { RETENTION_SCHEMA } from "./retention-schema.js";
export { WAIVER_ADJUDICATION_RECOVERY_MIGRATION } from "./waiver-adjudication-recovery-schema.js";

/**
 * Validate the schema state that is about to become authoritative. This runs
 * while the forward migration transaction is still open so a failed check
 * cannot leave a partially migrated database behind.
 *
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {number} schemaVersion
 */
export function validateResultingSchema(database, schemaVersion) {
  const userVersion = database
    .prepare("PRAGMA user_version")
    .get()?.user_version;
  if (userVersion !== schemaVersion) {
    fail(
      "schema_invalid",
      `SQLite schema version ${String(userVersion)} is not ${schemaVersion}`,
    );
  }

  let storedVersion;
  try {
    storedVersion = database
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key='schema_version'",
      )
      .get()?.value;
  } catch (error) {
    fail("schema_invalid", "SQLite schema metadata is invalid", error);
  }
  if (storedVersion !== String(schemaVersion)) {
    fail(
      "schema_invalid",
      `SQLite schema metadata is ${storedVersion ?? "missing"}, not ${schemaVersion}`,
    );
  }

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    const actualTables = new Set(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((table) => table.name),
    );
    const missingTable = [...EXPECTED_SCHEMA_TABLES].find(
      (table) => !actualTables.has(table),
    );
    if (missingTable) {
      fail("schema_invalid", `SQLite schema table ${missingTable} is missing`);
    }
  }

  validateIntegrity(database);
  let foreignKeyViolation;
  try {
    foreignKeyViolation = database.prepare("PRAGMA foreign_key_check").get();
  } catch (error) {
    fail(
      "foreign_key_check_failed",
      "SQLite foreign-key integrity check could not complete",
      error,
    );
  }
  if (foreignKeyViolation) {
    fail(
      "foreign_key_check_failed",
      "SQLite foreign-key check found violation",
    );
  }
}

export const REVIEW_RUN_REBUILD_CLEANUP = `
  DROP TRIGGER IF EXISTS review_run_transcript_chunk_immutable_update;
  DROP TRIGGER IF EXISTS review_run_transcript_chunk_immutable_delete;
  DROP TRIGGER IF EXISTS review_run_transcript_chunk_requires_started_run;
  DROP TABLE IF EXISTS review_run_transcript_chunks;
  DROP TRIGGER IF EXISTS criterion_result_requires_running_review_run;
`;

export const AUTHORITY_ATTRIBUTION_SCHEMA = `
  CREATE TABLE authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;

export const HOST_ATTRIBUTION_MIGRATION = `
  DROP INDEX authority_attributions_keyset;
  ALTER TABLE authority_attributions
    RENAME TO authority_attributions_v21;
  CREATE TABLE authority_attributions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'host', 'implementer_token')),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
    error_code TEXT,
    occurred_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO authority_attributions (
    id,
    channel,
    action,
    outcome,
    error_code,
    occurred_at
  )
  SELECT
    id,
    channel,
    action,
    outcome,
    error_code,
    occurred_at
  FROM authority_attributions_v21;
  DROP TABLE authority_attributions_v21;
  CREATE INDEX authority_attributions_keyset
    ON authority_attributions (occurred_at DESC, id DESC);
`;
import { fail } from "./durable-error.js";
