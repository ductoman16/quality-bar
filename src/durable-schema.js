import { DurableCoreError, fail } from "./durable-error.js";
import {
  REVIEW_ASSIGNMENT_MIGRATION,
  REVIEW_ASSIGNMENT_SCHEMA,
} from "./review-assignment-schema.js";
import {
  GITHUB_CONNECTION_HEALTH_MIGRATION,
  GITHUB_CONNECTION_LIFECYCLE_MIGRATION,
  GITHUB_CONNECTION_SCHEMA,
  GITHUB_REPOSITORY_SCHEMA,
} from "./github-connection-schema.js";
import * as schemaMigration from "./durable-schema-migration.js";
import {
  GITHUB_POLLING_MIGRATION,
  GITHUB_POLLING_SCHEMA,
} from "./github-polling-schema.js";
import { REPOSITORY_CREDENTIAL_SCHEMA } from "./repository-credential-schema.js";
import * as repositorySchema from "./repository-schema.js";
import {
  FORGEJO_CONNECTION_LIFECYCLE_MIGRATION,
  FORGEJO_CONNECTION_SCHEMA,
  FORGEJO_VERIFICATION_HISTORY_MIGRATION,
} from "./forgejo-connection-schema.js";
import {
  FORGEJO_POLLING_MIGRATION,
  FORGEJO_POLLING_SCHEMA,
} from "./forgejo-polling-schema.js";
import { normalizedForgejoBaseUrl } from "./forgejo-v16.js";
import { WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA } from "./waiver-adjudicator-configuration.js";
import {
  CRITERION_RESULT_MEANING_MIGRATION,
  EVALUATION_SCHEMA,
  FINDING_RESULT_MIGRATION,
} from "./evaluation-schema.js";
import { reviewRunResultColumnMigration } from "./review-run-result-schema-migration.js";
import * as reviewDeletionSchema from "./review-deletion-schema.js";
export const SCHEMA_VERSION = schemaMigration.CURRENT_SCHEMA_VERSION;
const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    active_version_id TEXT NOT NULL REFERENCES review_versions(id) DEFERRABLE INITIALLY DEFERRED,
    archived_at INTEGER,
    hard_delete_pending INTEGER NOT NULL DEFAULT 0
      CHECK (hard_delete_pending IN (0, 1)),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_versions (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    number INTEGER NOT NULL CHECK (number > 0),
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    service_tier TEXT NOT NULL,
    applicability_rule TEXT,
    created_at INTEGER NOT NULL,
    sealed_at INTEGER,
    UNIQUE (review_id, number)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS criteria (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
    impact TEXT NOT NULL CHECK (impact IN ('advisory', 'blocking')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_version_criteria (
    review_version_id TEXT NOT NULL REFERENCES review_versions(id),
    criterion_id TEXT NOT NULL REFERENCES criteria(id),
    position INTEGER NOT NULL CHECK (position > 0),
    instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
    impact TEXT NOT NULL CHECK (impact IN ('advisory', 'blocking')),
    PRIMARY KEY (review_version_id, criterion_id),
    UNIQUE (review_version_id, position)
  ) STRICT;
  ${REVIEW_ASSIGNMENT_SCHEMA}
  CREATE TRIGGER IF NOT EXISTS review_versions_immutable_update
    BEFORE UPDATE ON review_versions
    WHEN OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'review_version_immutable'); END;
  ${reviewDeletionSchema.REVIEW_DELETION_IMMUTABILITY}
  CREATE TRIGGER IF NOT EXISTS criteria_immutable_update
    BEFORE UPDATE ON criteria
    BEGIN SELECT RAISE(ABORT, 'criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_update
    BEFORE UPDATE ON review_version_criteria
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_insert
    BEFORE INSERT ON review_version_criteria
    WHEN (SELECT sealed_at FROM review_versions WHERE id = NEW.review_version_id) IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
`;

export function initializeOrValidateSchema(
  /** @type {import("node:sqlite").DatabaseSync} */ database,
) {
  const version = /** @type {{ user_version: number }} */ (
    database.prepare("PRAGMA user_version").get()
  ).user_version;
  if ([16, 17, 18].includes(version)) {
    database.function(
      "quality_bar_normalize_forgejo_url",
      { deterministic: true, directOnly: true },
      (baseUrl) => {
        if (typeof baseUrl !== "string") {
          fail("schema_invalid", "Stored Forgejo Connection URL is not text");
        }
        return normalizedForgejoBaseUrl(baseUrl);
      },
    );
  }
  if (version === 0) {
    const existingTables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    if (existingTables.length > 0) {
      fail(
        "schema_invalid",
        "SQLite schema version 0 contains unsupported tables",
      );
    }
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE quality_bar_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE browser_sessions (
        session_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_authenticated_at INTEGER NOT NULL
      ) STRICT;
      ${schemaMigration.AUTHORITY_ATTRIBUTION_SCHEMA}
      ${REVIEW_SCHEMA}
      ${repositorySchema.REPOSITORY_SCHEMA}
      ${REPOSITORY_CREDENTIAL_SCHEMA}
      ${GITHUB_CONNECTION_SCHEMA}
      ${GITHUB_POLLING_SCHEMA}
      ${FORGEJO_CONNECTION_SCHEMA}
      ${FORGEJO_POLLING_SCHEMA}
      ${WAIVER_ADJUDICATOR_CONFIGURATION_SCHEMA}
      ${EVALUATION_SCHEMA}
      ${reviewDeletionSchema.REVIEW_DELETION_LINEAGE_INTEGRITY}
      ${repositorySchema.REPOSITORY_USAGE_INTEGRITY}
      INSERT INTO quality_bar_metadata (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version === 1) {
    schemaMigration.migrateSchema(
      database,
      `
        CREATE TABLE browser_sessions (
          session_hash TEXT PRIMARY KEY,
          csrf_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_authenticated_at INTEGER NOT NULL
        ) STRICT;
        ${schemaMigration.AUTHORITY_ATTRIBUTION_SCHEMA}
        ${REVIEW_SCHEMA}
        ${repositorySchema.REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
        ${GITHUB_POLLING_MIGRATION}
      `,
      SCHEMA_VERSION,
    );
  } else if (version === 2 || version === 3) {
    schemaMigration.migrateSchema(
      database,
      `
        DROP TABLE browser_sessions;
        CREATE TABLE browser_sessions (
          session_hash TEXT PRIMARY KEY,
          csrf_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_authenticated_at INTEGER NOT NULL
        ) STRICT;
        ${schemaMigration.AUTHORITY_ATTRIBUTION_SCHEMA}
        ${REVIEW_SCHEMA}
        ${repositorySchema.REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
        ${GITHUB_POLLING_MIGRATION}
      `,
    );
  } else if (version === 4) {
    schemaMigration.migrateSchema(
      database,
      `
        ${schemaMigration.AUTHORITY_ATTRIBUTION_SCHEMA}
        ${REVIEW_SCHEMA}
        ${repositorySchema.REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
        ${GITHUB_POLLING_MIGRATION}
      `,
    );
  } else if (version === 5) {
    schemaMigration.migrateSchema(
      database,
      `${REVIEW_SCHEMA}${repositorySchema.REPOSITORY_SCHEMA}${REPOSITORY_CREDENTIAL_SCHEMA}${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 6) {
    schemaMigration.migrateSchema(
      database,
      `
        ALTER TABLE review_versions ADD COLUMN applicability_rule TEXT;
        DROP TRIGGER review_version_criteria_immutable_update;
        DROP TRIGGER review_version_criteria_immutable_delete;
        DROP TRIGGER review_version_criteria_immutable_insert;
        ALTER TABLE review_version_criteria
          RENAME TO review_version_criteria_v6;
        CREATE TABLE review_version_criteria (
          review_version_id TEXT NOT NULL REFERENCES review_versions(id),
          criterion_id TEXT NOT NULL REFERENCES criteria(id),
          position INTEGER NOT NULL CHECK (position > 0),
          instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
          impact TEXT NOT NULL CHECK (impact IN ('advisory', 'blocking')),
          PRIMARY KEY (review_version_id, criterion_id),
          UNIQUE (review_version_id, position)
        ) STRICT;
        INSERT INTO review_version_criteria (
          review_version_id,
          criterion_id,
          position,
          instruction,
          impact
        )
        SELECT
          version_criterion.review_version_id,
          version_criterion.criterion_id,
          version_criterion.position,
          criteria.instruction,
          criteria.impact
        FROM review_version_criteria_v6 AS version_criterion
        JOIN criteria ON criteria.id = version_criterion.criterion_id;
        DROP TABLE review_version_criteria_v6;
        CREATE TRIGGER review_version_criteria_immutable_update
          BEFORE UPDATE ON review_version_criteria
          BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
        CREATE TRIGGER review_version_criteria_immutable_delete
          BEFORE DELETE ON review_version_criteria
          BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
        CREATE TRIGGER review_version_criteria_immutable_insert
          BEFORE INSERT ON review_version_criteria
          WHEN (
            SELECT sealed_at
            FROM review_versions
            WHERE id = NEW.review_version_id
          ) IS NOT NULL
          BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
        ALTER TABLE reviews ADD COLUMN archived_at INTEGER;
        ${repositorySchema.REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${REVIEW_ASSIGNMENT_MIGRATION}
        ${GITHUB_CONNECTION_SCHEMA}
        ${GITHUB_POLLING_MIGRATION}
      `,
    );
  } else if (version === 7) {
    schemaMigration.migrateSchema(
      database,
      `ALTER TABLE reviews ADD COLUMN archived_at INTEGER;
       ${repositorySchema.REPOSITORY_SCHEMA}
       ${REPOSITORY_CREDENTIAL_SCHEMA}
       ${REVIEW_ASSIGNMENT_MIGRATION}
       ${GITHUB_CONNECTION_SCHEMA}
       ${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 8) {
    schemaMigration.migrateSchema(
      database,
      `${repositorySchema.REPOSITORY_SCHEMA}${REPOSITORY_CREDENTIAL_SCHEMA}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 9) {
    schemaMigration.migrateSchema(
      database,
      `${REPOSITORY_CREDENTIAL_SCHEMA}${repositorySchema.REPOSITORY_LIFECYCLE_MIGRATION}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 10) {
    schemaMigration.migrateSchema(
      database,
      `${repositorySchema.REPOSITORY_LIFECYCLE_MIGRATION}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 11) {
    schemaMigration.migrateSchema(
      database,
      `${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 12) {
    schemaMigration.migrateSchema(
      database,
      `${GITHUB_CONNECTION_SCHEMA}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 13 || version === 14) {
    schemaMigration.migrateSchema(
      database,
      version === 13
        ? `${GITHUB_CONNECTION_HEALTH_MIGRATION}${GITHUB_CONNECTION_LIFECYCLE_MIGRATION}${GITHUB_REPOSITORY_SCHEMA}${GITHUB_POLLING_MIGRATION}`
        : `${GITHUB_CONNECTION_LIFECYCLE_MIGRATION}${GITHUB_POLLING_MIGRATION}`,
    );
  } else if (version === 15) {
    schemaMigration.migrateSchema(database, GITHUB_POLLING_MIGRATION);
  } else if (version === 16) {
    schemaMigration.migrateSchema(database, FORGEJO_CONNECTION_SCHEMA);
  } else if (version === 17) {
    schemaMigration.migrateSchema(
      database,
      FORGEJO_VERIFICATION_HISTORY_MIGRATION,
    );
  } else if (version === 18) {
    schemaMigration.migrateSchema(
      database,
      FORGEJO_CONNECTION_LIFECYCLE_MIGRATION,
    );
  } else if (version === 19 || version === 20) {
    schemaMigration.migrateSchema(database, FORGEJO_POLLING_MIGRATION);
  } else if (version === 21 || version === 22 || version === 23) {
    schemaMigration.migrateSchema(
      database,
      "DROP TRIGGER IF EXISTS criterion_result_requires_running_review_run;",
    );
  } else if (version === 24) {
    schemaMigration.migrateSchema(
      database,
      `
        ALTER TABLE codex_execution_queue
          ADD COLUMN worker_id TEXT
          CHECK (worker_id IS NULL OR length(worker_id) > 0);
        ALTER TABLE codex_execution_queue
          ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0
          CHECK (fencing_token >= 0);
        ALTER TABLE codex_execution_queue
          ADD COLUMN lease_expires_at INTEGER;
        ${reviewRunResultColumnMigration(database)}
      `,
    );
  } else if (version === 25) {
    schemaMigration.migrateSchema(
      database,
      reviewRunResultColumnMigration(database),
    );
  } else if (version === 26) {
    schemaMigration.migrateSchema(
      database,
      `${reviewRunResultColumnMigration(database)}${FINDING_RESULT_MIGRATION}`,
    );
  } else if (version === 27) {
    schemaMigration.migrateSchema(
      database,
      `${reviewRunResultColumnMigration(database)}${CRITERION_RESULT_MEANING_MIGRATION}`,
    );
  } else if (version === 28) {
    schemaMigration.migrateSchema(database, "");
  } else if (version === 29) {
    schemaMigration.finalizeSchemaMigration(database, version);
  } else if (version !== SCHEMA_VERSION) {
    schemaMigration.finalizeSchemaMigration(database, version);
  }
  try {
    const storedVersion = database
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key='schema_version'",
      )
      .get()?.value;
    if (storedVersion !== String(SCHEMA_VERSION)) {
      fail(
        "schema_invalid",
        `SQLite schema metadata is ${storedVersion ?? "missing"}, not ${SCHEMA_VERSION}`,
      );
    }
  } catch (error) {
    if (error instanceof DurableCoreError) {
      throw error;
    }
    fail("schema_invalid", "SQLite schema metadata is invalid", error);
  }
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
      "SQLite foreign-key integrity check found a violation",
    );
  }
}
