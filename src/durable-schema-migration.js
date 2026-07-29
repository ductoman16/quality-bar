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
  database.exec(`
    BEGIN IMMEDIATE;
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `DROP TRIGGER IF EXISTS review_run_queue_reference_delete;
           DROP TRIGGER IF EXISTS waiver_adjudication_queue_reference_delete;`
        : ""
    }
    ${statements}
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
    ${queueNeedsWaiverKind ? WAIVER_QUEUE_MIGRATION : ""}
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `${HOST_ATTRIBUTION_MIGRATION}${FORGEJO_CONNECTION_SCHEMA}${FORGEJO_POLLING_MIGRATION}${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}${reviewRunEvidenceStatements}${fileChangeTableExists && !fileChangeHasKinds ? EVALUATION_FILE_CHANGE_KIND_MIGRATION : ""}${evaluationCancellationStatements}${EVALUATION_SCHEMA}${WAIVER_BATCH_SCHEMA}${repositoryHasUsageMarker || migrationCreatesUsageMarker ? "" : REPOSITORY_USAGE_MIGRATION}${REPOSITORY_USAGE_INTEGRITY}${reviewHasDeletionMarker || migrationCreatesDeletionMarker ? "" : REVIEW_DELETION_COLUMN_MIGRATION}${REVIEW_DELETION_INTEGRITY}${GITHUB_FEEDBACK_SCHEMA}`
        : ""
    }
    UPDATE quality_bar_metadata
    SET value = '${schemaVersion}'
    WHERE key = 'schema_version';
    PRAGMA user_version = ${schemaVersion};
    COMMIT;
  `);
}
export function finalizeSchemaMigration(
  /** @type {import("node:sqlite").DatabaseSync} */ database,
  /** @type {number} */ version,
) {
  if (![29, 30, 31, 32, 33, 34, 35, 36, 37, 38].includes(version)) {
    fail("schema_invalid", `SQLite schema version ${version} is not supported`);
  }
  if (version === 35) {
    migrateEvaluationCancellationReason(database, migrateSchema);
    return;
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
    UPDATE evaluations
    SET applicability_sealed_at = created_at
    WHERE applicability_sealed_at IS NULL;`,
  );
}
export const CURRENT_SCHEMA_VERSION = 39;
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
