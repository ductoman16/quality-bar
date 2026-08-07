import { DatabaseSync } from "node:sqlite";

import { createDurableAccess } from "./durable-access.js";
import { DurableCoreError, fail } from "./durable-error.js";
import { configureDatabase, validateIntegrity } from "./durable-integrity.js";
import {
  initializeOrValidateSchema,
  SCHEMA_VERSION,
} from "./durable-schema.js";
import { validateResultingSchema } from "./durable-schema-migration.js";

export { DurableCoreError } from "./durable-error.js";
const SQLITE_LOCK_WAIT_MILLISECONDS = 1_000;

/** @param {DatabaseSync} database */
/** @param {DatabaseSync} database @param {number} schemaVersionBeforeMigration */
function readFacts(database, schemaVersionBeforeMigration) {
  return {
    databaseVersion: /** @type {{ version: string }} */ (
      database.prepare("SELECT sqlite_version() AS version").get()
    ).version,
    foreignKeys: true,
    integrity: "ok",
    journalMode: "wal",
    schemaVersion: SCHEMA_VERSION,
    schemaVersionBeforeMigration,
    synchronous: "full",
  };
}

/**
 * @param {string} databasePath
 * @param {{ onStorageUnavailable?: (error: DurableCoreError) => void }} options
 */
export function openDurableCore(databasePath, { onStorageUnavailable } = {}) {
  let database;
  let schemaVersionBeforeMigration;
  const retentionCleanupState = { active: false };
  try {
    database = new DatabaseSync(databasePath, {
      timeout: SQLITE_LOCK_WAIT_MILLISECONDS,
    });
  } catch (error) {
    fail("sqlite_open_failed", "SQLite database could not be opened", error);
  }

  try {
    configureDatabase(database);
    database.function("quality_bar_retention_cleanup", () =>
      retentionCleanupState.active ? 1 : 0,
    );
    validateIntegrity(database);
    schemaVersionBeforeMigration = /** @type {{ user_version: number }} */ (
      database.prepare("PRAGMA user_version").get()
    ).user_version;
    if (
      !Number.isSafeInteger(schemaVersionBeforeMigration) ||
      schemaVersionBeforeMigration < 0
    ) {
      fail("schema_invalid", "SQLite schema version is invalid");
    }
    initializeOrValidateSchema(database);
    validateResultingSchema(database, SCHEMA_VERSION);
  } catch (error) {
    database.close();
    if (error instanceof DurableCoreError) {
      throw error;
    }
    fail("schema_invalid", "SQLite schema could not be initialized", error);
  }

  return {
    facts: readFacts(
      database,
      /** @type {number} */ (schemaVersionBeforeMigration),
    ),
    ...createDurableAccess(database, {
      onStorageUnavailable,
      retentionCleanupState,
    }),
  };
}
