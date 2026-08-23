import { DatabaseSync } from "node:sqlite";

import { createDurableAccess } from "./durable-access.js";
import { DurableCoreError, fail } from "./durable-error.js";
import { configureDatabase, validateIntegrity } from "./durable-integrity.js";
import { initializeOrValidateSchema } from "./durable-schema.js";
import { validateResultingSchema } from "./durable-schema-validation.js";

export { DurableCoreError } from "./durable-error.js";
const SQLITE_LOCK_WAIT_MILLISECONDS = 1_000;

/** @param {DatabaseSync} database */
function readFacts(database) {
  return {
    databaseVersion: /** @type {{ version: string }} */ (
      database.prepare("SELECT sqlite_version() AS version").get()
    ).version,
    foreignKeys: true,
    integrity: "ok",
    journalMode: "wal",
    synchronous: "full",
  };
}

/**
 * @param {string} databasePath
 * @param {{ onStorageUnavailable?: (error: DurableCoreError) => void }} options
 */
export function openDurableCore(databasePath, { onStorageUnavailable } = {}) {
  let database;
  const retentionCleanupState = { active: false };
  try {
    database = new DatabaseSync(databasePath, {
      timeout: SQLITE_LOCK_WAIT_MILLISECONDS,
    });
  } catch (error) {
    fail("sqlite_open_failed", "SQLite database could not be opened", error);
  }

  try {
    database.function("quality_bar_retention_cleanup", () =>
      retentionCleanupState.active ? 1 : 0,
    );
    validateIntegrity(database);
    initializeOrValidateSchema(database);
    validateResultingSchema(database);
    configureDatabase(database);
  } catch (error) {
    database.close();
    if (error instanceof DurableCoreError) {
      throw error;
    }
    fail("schema_invalid", "SQLite schema could not be initialized", error);
  }

  return {
    facts: readFacts(database),
    ...createDurableAccess(database, {
      onStorageUnavailable,
      retentionCleanupState,
    }),
  };
}
