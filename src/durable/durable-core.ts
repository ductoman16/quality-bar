import { DatabaseSync } from "node:sqlite";

import { createDurableAccess } from "./durable-access.ts";
import { DurableCoreError, fail } from "./durable-error.ts";
import { configureDatabase, validateIntegrity } from "./durable-integrity.ts";
import { initializeOrValidateSchema } from "./durable-schema.ts";
import { validateResultingSchema } from "./durable-schema-validation.ts";

export { DurableCoreError } from "./durable-error.ts";
const SQLITE_LOCK_WAIT_MILLISECONDS = 1_000;

function readFacts(database: DatabaseSync) {
  return {
    databaseVersion: (
      database.prepare("SELECT sqlite_version() AS version").get() as {
        version: string;
      }
    ).version,
    foreignKeys: true,
    integrity: "ok",
    journalMode: "wal",
    synchronous: "full",
  };
}

export function openDurableCore(
  databasePath: string,
  {
    onStorageUnavailable,
  }: { onStorageUnavailable?: (error: DurableCoreError) => void } = {},
) {
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
