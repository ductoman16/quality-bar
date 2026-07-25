import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
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
    fail(
      "foreign_keys_unavailable",
      "SQLite foreign keys are not enabled",
    );
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
      INSERT INTO quality_bar_metadata (key, value)
      VALUES ('schema_version', '${SCHEMA_VERSION}');
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (version !== SCHEMA_VERSION) {
    fail(
      "schema_invalid",
      `SQLite schema version ${version} is not supported`,
    );
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
    databaseVersion: database.prepare("SELECT sqlite_version() AS version").get()
      .version,
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
    run(sql, ...parameters) {
      return execute("run", sql, parameters);
    },
    transaction(callback) {
      assertAvailable();
      let transactionStarted = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        const result = callback({
          get(sql, ...parameters) {
            const row = execute("get", sql, parameters);
            return row ? { ...row } : undefined;
          },
          run(sql, ...parameters) {
            return execute("run", sql, parameters);
          },
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        let rollbackError = null;
        if (transactionStarted) {
          try {
            database.exec("ROLLBACK");
          } catch (caughtRollbackError) {
            rollbackError = caughtRollbackError;
          }
        }

        if (rollbackError) {
          const combinedError = new AggregateError(
            [error, rollbackError],
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
