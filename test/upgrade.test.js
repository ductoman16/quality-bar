import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  migrateSchema,
  validateResultingSchema,
} from "../src/durable-schema-migration.js";

test("resulting-schema validation rolls back a failed forward migration", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO quality_bar_metadata (key, value)
    VALUES ('schema_version', '1');
    CREATE TABLE parents (id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE children (
      parent_id INTEGER NOT NULL REFERENCES parents(id)
    ) STRICT;
    INSERT INTO children (parent_id) VALUES (999);
    PRAGMA user_version = 1;
    PRAGMA foreign_keys = ON;
  `);

  assert.throws(
    () =>
      migrateSchema(
        database,
        "CREATE TABLE migration_candidate (id INTEGER PRIMARY KEY) STRICT;",
        2,
      ),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "foreign_key_check_failed");
      assert.equal(error.message, "SQLite foreign-key check found violation");
      return true;
    },
  );

  assert.equal(
    database
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
      )
      .get()?.value,
    "1",
  );
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 1);
  assert.equal(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'migration_candidate'",
      )
      .get(),
    undefined,
  );

  database.close();
});

test("resulting-schema validation rejects a missing expected table", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO quality_bar_metadata (key, value)
    VALUES ('schema_version', '49');
    PRAGMA user_version = 49;
  `);

  assert.throws(
    () => validateResultingSchema(database, 49),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "schema_invalid");
      assert.equal(
        error.message,
        "SQLite schema table applicability_results is missing",
      );
      return true;
    },
  );
  database.close();
});
