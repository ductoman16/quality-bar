import { DurableCoreError, fail } from "./durable-error.js";

export const SCHEMA_VERSION = 6;

const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    active_version_id TEXT NOT NULL REFERENCES review_versions(id) DEFERRABLE INITIALLY DEFERRED,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_versions (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    number INTEGER NOT NULL CHECK (number > 0),
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    service_tier TEXT NOT NULL,
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
    PRIMARY KEY (review_version_id, criterion_id),
    UNIQUE (review_version_id, position)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS review_assignments (
    review_id TEXT PRIMARY KEY REFERENCES reviews(id),
    scope TEXT NOT NULL CHECK (scope = 'installation_wide'),
    created_at INTEGER NOT NULL
  ) STRICT;
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

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {string} statements
 */
function migration(database, statements) {
  database.exec(`
    BEGIN IMMEDIATE;
    ${statements}
    UPDATE quality_bar_metadata
    SET value = '${SCHEMA_VERSION}'
    WHERE key = 'schema_version';
    PRAGMA user_version = ${SCHEMA_VERSION};
    COMMIT;
  `);
}

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
      `,
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
      `,
    );
  } else if (version === 5) {
    migration(database, REVIEW_SCHEMA);
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
