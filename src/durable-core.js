import { DatabaseSync } from "node:sqlite";

import { createDurableAccess } from "./durable-access.js";
import { DurableCoreError, fail } from "./durable-error.js";
import { configureDatabase, validateIntegrity } from "./durable-integrity.js";
import {
  initializeOrValidateSchema,
  SCHEMA_VERSION,
} from "./durable-schema.js";

export { DurableCoreError } from "./durable-error.js";

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

  return {
    facts: readFacts(database),
    ...createDurableAccess(database, { onStorageUnavailable }),
  };
}
