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
  database.exec(`
    BEGIN IMMEDIATE;
    ${statements}
    ${
      schemaVersion === CURRENT_SCHEMA_VERSION
        ? `${HOST_ATTRIBUTION_MIGRATION}${FORGEJO_CONNECTION_SCHEMA}${FORGEJO_POLLING_MIGRATION}${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}${fileChangeTableExists && !fileChangeHasKinds ? EVALUATION_FILE_CHANGE_KIND_MIGRATION : ""}${EVALUATION_SCHEMA}${repositoryHasUsageMarker || migrationCreatesUsageMarker ? "" : REPOSITORY_USAGE_MIGRATION}${REPOSITORY_USAGE_INTEGRITY}${reviewHasDeletionMarker || migrationCreatesDeletionMarker ? "" : REVIEW_DELETION_COLUMN_MIGRATION}${REVIEW_DELETION_INTEGRITY}`
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
  if (![29, 30, 31].includes(version)) {
    fail("schema_invalid", `SQLite schema version ${version} is not supported`);
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
export const CURRENT_SCHEMA_VERSION = 32;
import { FORGEJO_CONNECTION_SCHEMA } from "./forgejo-connection-schema.js";
import { FORGEJO_POLLING_MIGRATION } from "./forgejo-polling-schema.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import {
  EVALUATION_FILE_CHANGE_KIND_MIGRATION,
  EVALUATION_SCHEMA,
} from "./evaluation-schema.js";
import {
  REPOSITORY_USAGE_INTEGRITY,
  REPOSITORY_USAGE_MIGRATION,
} from "./repository-schema.js";
import {
  REVIEW_DELETION_COLUMN_MIGRATION,
  REVIEW_DELETION_INTEGRITY,
} from "./review-deletion-schema.js";

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
