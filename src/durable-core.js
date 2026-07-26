import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 6;
const FATAL_SQLITE_CODES = [
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_CANTOPEN",
  "SQLITE_CORRUPT",
  "SQLITE_FULL",
  "SQLITE_IOERR",
  "SQLITE_NOTADB",
  "SQLITE_PROTOCOL",
  "SQLITE_READONLY",
];
const FATAL_SQLITE_RESULT_CODES = new Set([5, 6, 8, 10, 11, 13, 14, 15, 26]);
const AsyncFunction = async function () {}.constructor;

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

export class DurableCoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "DurableCoreError";
    this.code = code;
  }
}

function sqliteCode(error) {
  return typeof error?.code === "string" ? error.code : "";
}

function isFatalSqliteWrite(error) {
  const code = sqliteCode(error);
  return (
    FATAL_SQLITE_RESULT_CODES.has(error?.errcode & 0xff) ||
    FATAL_SQLITE_CODES.some(
      (fatalCode) => code === fatalCode || code.startsWith(`${fatalCode}_`),
    )
  );
}

function isSqliteCorruption(error) {
  return [11, 26].includes(error?.errcode & 0xff);
}

function scalar(database, pragma, field) {
  return database.prepare(pragma).get()?.[field];
}

function fail(code, message, cause) {
  throw new DurableCoreError(code, message, { cause });
}

function configureDatabase(database) {
  try {
    database.exec("PRAGMA foreign_keys = ON");
  } catch (error) {
    if (isSqliteCorruption(error)) {
      fail("integrity_check_failed", "SQLite database is not valid", error);
    }
    fail(
      "foreign_keys_unavailable",
      "SQLite foreign keys could not be enabled",
      error,
    );
  }

  const foreignKeys = scalar(database, "PRAGMA foreign_keys", "foreign_keys");
  if (foreignKeys !== 1) {
    fail("foreign_keys_unavailable", "SQLite foreign keys are not enabled");
  }

  let journalMode;
  try {
    journalMode = scalar(database, "PRAGMA journal_mode = WAL", "journal_mode");
  } catch (error) {
    if (isSqliteCorruption(error)) {
      fail("integrity_check_failed", "SQLite database is not valid", error);
    }
    fail("wal_unavailable", "SQLite WAL mode could not be enabled", error);
  }
  if (journalMode !== "wal") {
    fail(
      "wal_unavailable",
      `SQLite journal mode is ${journalMode ?? "unknown"}, not wal`,
    );
  }

  try {
    database.exec("PRAGMA synchronous = FULL");
  } catch (error) {
    if (isSqliteCorruption(error)) {
      fail("integrity_check_failed", "SQLite database is not valid", error);
    }
    fail(
      "durable_synchronization_unavailable",
      "SQLite durable synchronization could not be enabled",
      error,
    );
  }
  if (scalar(database, "PRAGMA synchronous", "synchronous") !== 2) {
    fail(
      "durable_synchronization_unavailable",
      "SQLite synchronous mode is not full",
    );
  }
}

function validateIntegrity(database) {
  let result;
  try {
    result = scalar(database, "PRAGMA integrity_check", "integrity_check");
  } catch (error) {
    fail(
      "integrity_check_failed",
      "SQLite integrity check could not complete",
      error,
    );
  }

  if (result !== "ok") {
    fail(
      "integrity_check_failed",
      `SQLite integrity check returned ${result ?? "no result"}`,
    );
  }
}

function initializeOrValidateSchema(database) {
  const version = scalar(database, "PRAGMA user_version", "user_version");
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
    database.exec(`
      BEGIN IMMEDIATE;
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
      UPDATE quality_bar_metadata
      SET value = '${SCHEMA_VERSION}'
      WHERE key = 'schema_version';
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version === 2 || version === 3) {
    database.exec(`
      BEGIN IMMEDIATE;
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
      UPDATE quality_bar_metadata
      SET value = '${SCHEMA_VERSION}'
      WHERE key = 'schema_version';
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version === 4) {
    database.exec(`
      BEGIN IMMEDIATE;
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
      UPDATE quality_bar_metadata
      SET value = '${SCHEMA_VERSION}'
      WHERE key = 'schema_version';
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version === 5) {
    database.exec(`
      BEGIN IMMEDIATE;
      ${REVIEW_SCHEMA}
      UPDATE quality_bar_metadata
      SET value = '${SCHEMA_VERSION}'
      WHERE key = 'schema_version';
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
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

function readFacts(database) {
  return {
    databaseVersion: database
      .prepare("SELECT sqlite_version() AS version")
      .get().version,
    foreignKeys: true,
    integrity: "ok",
    journalMode: "wal",
    schemaVersion: SCHEMA_VERSION,
    synchronous: "full",
  };
}

export function openDurableCore(databasePath, { onStorageUnavailable } = {}) {
  let database;
  try {
    database = new DatabaseSync(databasePath);
  } catch (error) {
    fail("sqlite_open_failed", "SQLite database could not be opened", error);
  }

  try {
    configureDatabase(database);
    validateIntegrity(database);
    initializeOrValidateSchema(database);
  } catch (error) {
    database.close();
    if (error instanceof DurableCoreError) {
      throw error;
    }
    fail("schema_invalid", "SQLite schema could not be initialized", error);
  }

  let storageFailure = null;

  function assertAvailable() {
    if (storageFailure) {
      throw storageFailure;
    }
  }

  function enterStorageUnavailable(error) {
    if (!storageFailure) {
      storageFailure = new DurableCoreError(
        "storage_unavailable",
        "SQLite durable write failed",
        { cause: error },
      );
      onStorageUnavailable?.(storageFailure);
    } else if (error instanceof AggregateError) {
      storageFailure.cause = error;
    }
    throw storageFailure;
  }

  function execute(method, sql, parameters) {
    assertAvailable();
    try {
      return database.prepare(sql)[method](...parameters);
    } catch (error) {
      if (method === "run" && isFatalSqliteWrite(error)) {
        return enterStorageUnavailable(error);
      }
      throw error;
    }
  }

  return {
    facts: readFacts(database),
    get(sql, ...parameters) {
      const row = execute("get", sql, parameters);
      return row ? { ...row } : undefined;
    },
    all(sql, ...parameters) {
      return execute("all", sql, parameters).map((row) => ({ ...row }));
    },
    run(sql, ...parameters) {
      return execute("run", sql, parameters);
    },
    transaction(callback) {
      assertAvailable();
      if (callback instanceof AsyncFunction) {
        throw new DurableCoreError(
          "asynchronous_transaction_unsupported",
          "SQLite transaction callback must be synchronous",
        );
      }
      let transactionStarted = false;
      let transactionActive = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        transactionActive = true;
        let result;
        try {
          result = callback({
            get(sql, ...parameters) {
              if (!transactionActive) {
                throw new DurableCoreError(
                  "transaction_closed",
                  "SQLite transaction is no longer active",
                );
              }
              const row = execute("get", sql, parameters);
              return row ? { ...row } : undefined;
            },
            all(sql, ...parameters) {
              if (!transactionActive) {
                throw new DurableCoreError(
                  "transaction_closed",
                  "SQLite transaction is no longer active",
                );
              }
              return execute("all", sql, parameters).map((row) => ({ ...row }));
            },
            run(sql, ...parameters) {
              if (!transactionActive) {
                throw new DurableCoreError(
                  "transaction_closed",
                  "SQLite transaction is no longer active",
                );
              }
              return execute("run", sql, parameters);
            },
          });
        } finally {
          transactionActive = false;
        }
        if (typeof result?.then === "function") {
          const asynchronousTransactionError = new DurableCoreError(
            "asynchronous_transaction_unsupported",
            "SQLite transaction callback must be synchronous",
          );
          Promise.resolve(result).catch((error) => {
            asynchronousTransactionError.cause = error;
          });
          throw asynchronousTransactionError;
        }
        database.exec("COMMIT");
        return result;
      } catch (error) {
        transactionActive = false;
        let rollbackError = null;
        if (transactionStarted) {
          try {
            database.exec("ROLLBACK");
          } catch (caughtRollbackError) {
            rollbackError = caughtRollbackError;
          }
        }

        if (rollbackError) {
          const originalFailure =
            error?.code === "storage_unavailable"
              ? (error.cause ?? error)
              : error;
          const combinedError = new AggregateError(
            [originalFailure, rollbackError],
            "SQLite transaction and rollback both failed",
          );
          if (
            error?.code === "storage_unavailable" ||
            isFatalSqliteWrite(error) ||
            isFatalSqliteWrite(rollbackError)
          ) {
            return enterStorageUnavailable(combinedError);
          }
          throw combinedError;
        }
        if (
          error?.code === "storage_unavailable" ||
          isFatalSqliteWrite(error)
        ) {
          return enterStorageUnavailable(error);
        }
        throw error;
      }
    },
    close() {
      database.close();
    },
  };
}
