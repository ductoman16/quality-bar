import { fail } from "./durable-error.js";

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

function sqliteCode(error) {
  return typeof error?.code === "string" ? error.code : "";
}

export function isFatalSqliteWrite(error) {
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

export function configureDatabase(database) {
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

export function validateIntegrity(database) {
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
