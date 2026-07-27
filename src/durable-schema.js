import { DurableCoreError, fail } from "./durable-error.js";
import {
  REVIEW_ASSIGNMENT_MIGRATION,
  REVIEW_ASSIGNMENT_SCHEMA,
} from "./review-assignment-schema.js";
import { GITHUB_CONNECTION_SCHEMA } from "./github-connection-schema.js";
import {
  CURRENT_SCHEMA_VERSION,
  migrateSchema as migration,
} from "./durable-schema-migration.js";

export const SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

const REPOSITORY_HEALTH_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS repository_health_integrity_insert
    BEFORE INSERT ON repositories
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'repository_health_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS repository_health_integrity_update
    BEFORE UPDATE OF health, health_error_code, health_error_message
    ON repositories
    WHEN NOT (
      (NEW.health = 'healthy'
        AND NEW.health_error_code IS NULL
        AND NEW.health_error_message IS NULL)
      OR
      (NEW.health = 'error'
        AND NEW.health_error_code IS NOT NULL
        AND NEW.health_error_message IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'repository_health_invalid'); END;
`;

const REPOSITORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    normalized_url TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    lifecycle TEXT NOT NULL DEFAULT 'enabled'
      CHECK (lifecycle IN ('enabled', 'disabled', 'retired')),
    health TEXT NOT NULL DEFAULT 'healthy'
      CHECK (health IN ('healthy', 'error')),
    health_error_code TEXT,
    health_error_message TEXT,
    CHECK (
      (health = 'healthy' AND health_error_code IS NULL AND health_error_message IS NULL)
      OR
      (health = 'error' AND health_error_code IS NOT NULL AND health_error_message IS NOT NULL)
    )
  ) STRICT;
  ${REPOSITORY_HEALTH_INTEGRITY}
`;

const REPOSITORY_LIFECYCLE_MIGRATION = `
  ALTER TABLE repositories ADD COLUMN lifecycle TEXT NOT NULL
    DEFAULT 'enabled'
    CHECK (lifecycle IN ('enabled', 'disabled', 'retired'));
  ALTER TABLE repositories ADD COLUMN health TEXT NOT NULL
    DEFAULT 'healthy'
    CHECK (health IN ('healthy', 'error'));
  ALTER TABLE repositories ADD COLUMN health_error_code TEXT;
  ALTER TABLE repositories ADD COLUMN health_error_message TEXT;
  ${REPOSITORY_HEALTH_INTEGRITY}
`;

const REPOSITORY_CREDENTIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS repository_credentials (
    repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
    encrypted_credential TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
`;

const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    active_version_id TEXT NOT NULL REFERENCES review_versions(id) DEFERRABLE INITIALLY DEFERRED,
    archived_at INTEGER,
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
  CREATE TRIGGER IF NOT EXISTS review_versions_immutable_delete
    BEFORE DELETE ON review_versions
    BEGIN SELECT RAISE(ABORT, 'review_version_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS criteria_immutable_update
    BEFORE UPDATE ON criteria
    BEGIN SELECT RAISE(ABORT, 'criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS criteria_immutable_delete
    BEFORE DELETE ON criteria
    BEGIN SELECT RAISE(ABORT, 'criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_update
    BEFORE UPDATE ON review_version_criteria
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_delete
    BEFORE DELETE ON review_version_criteria
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_version_criteria_immutable_insert
    BEFORE INSERT ON review_version_criteria
    WHEN (SELECT sealed_at FROM review_versions WHERE id = NEW.review_version_id) IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END;
`;

/** @param {import("node:sqlite").DatabaseSync} database */
export function initializeOrValidateSchema(database) {
  const version = /** @type {{ user_version: number }} */ (
    database.prepare("PRAGMA user_version").get()
  ).user_version;
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
      CREATE TABLE authority_attributions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
        action TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
        error_code TEXT,
        occurred_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX authority_attributions_keyset
        ON authority_attributions (occurred_at DESC, id DESC);
      ${REVIEW_SCHEMA}
      ${REPOSITORY_SCHEMA}
      ${REPOSITORY_CREDENTIAL_SCHEMA}
      ${GITHUB_CONNECTION_SCHEMA}
      INSERT INTO quality_bar_metadata (key, value)
      VALUES ('schema_version', '${SCHEMA_VERSION}');
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version === 1) {
    migration(
      database,
      `
        CREATE TABLE browser_sessions (
          session_hash TEXT PRIMARY KEY,
          csrf_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_authenticated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE authority_attributions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
          action TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
          error_code TEXT,
          occurred_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX authority_attributions_keyset
          ON authority_attributions (occurred_at DESC, id DESC);
        ${REVIEW_SCHEMA}
        ${REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
      `,
      SCHEMA_VERSION,
    );
  } else if (version === 2 || version === 3) {
    migration(
      database,
      `
        DROP TABLE browser_sessions;
        CREATE TABLE browser_sessions (
          session_hash TEXT PRIMARY KEY,
          csrf_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_authenticated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE authority_attributions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
          action TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
          error_code TEXT,
          occurred_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX authority_attributions_keyset
          ON authority_attributions (occurred_at DESC, id DESC);
        ${REVIEW_SCHEMA}
        ${REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
      `,
    );
  } else if (version === 4) {
    migration(
      database,
      `
        CREATE TABLE authority_attributions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
          action TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
          error_code TEXT,
          occurred_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX authority_attributions_keyset
          ON authority_attributions (occurred_at DESC, id DESC);
        ${REVIEW_SCHEMA}
        ${REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${GITHUB_CONNECTION_SCHEMA}
      `,
    );
  } else if (version === 5) {
    migration(
      database,
      `${REVIEW_SCHEMA}${REPOSITORY_SCHEMA}${REPOSITORY_CREDENTIAL_SCHEMA}${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 6) {
    migration(
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
        ${REPOSITORY_SCHEMA}
        ${REPOSITORY_CREDENTIAL_SCHEMA}
        ${REVIEW_ASSIGNMENT_MIGRATION}
        ${GITHUB_CONNECTION_SCHEMA}
      `,
    );
  } else if (version === 7) {
    migration(
      database,
      `ALTER TABLE reviews ADD COLUMN archived_at INTEGER;
       ${REPOSITORY_SCHEMA}
       ${REPOSITORY_CREDENTIAL_SCHEMA}
       ${REVIEW_ASSIGNMENT_MIGRATION}
       ${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 8) {
    migration(
      database,
      `${REPOSITORY_SCHEMA}${REPOSITORY_CREDENTIAL_SCHEMA}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 9) {
    migration(
      database,
      `${REPOSITORY_CREDENTIAL_SCHEMA}${REPOSITORY_LIFECYCLE_MIGRATION}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 10) {
    migration(
      database,
      `${REPOSITORY_LIFECYCLE_MIGRATION}${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 11) {
    migration(
      database,
      `${REVIEW_ASSIGNMENT_MIGRATION}${GITHUB_CONNECTION_SCHEMA}`,
    );
  } else if (version === 12) {
    migration(database, GITHUB_CONNECTION_SCHEMA);
  } else if (version !== SCHEMA_VERSION) {
    fail("schema_invalid", `SQLite schema version ${version} is not supported`);
  }

  try {
    const storedVersion = database
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
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
