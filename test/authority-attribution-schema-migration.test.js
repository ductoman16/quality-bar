import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";

test("migrates v22 authority attribution provenance without losing existing facts", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-authority-attribution-migration-"),
  );
  const databasePath = join(directory, "quality-bar.sqlite3");
  try {
    const core = openDurableCore(databasePath);
    core.transaction((transaction) => {
      transaction.run(
        `INSERT INTO authority_attributions
          (id, channel, action, outcome, error_code, occurred_at)
         VALUES ('attribution-1', 'browser_session', 'login', 'success', NULL, 1)`,
      );
      transaction.run("DROP INDEX authority_attributions_keyset");
      transaction.run(
        "ALTER TABLE authority_attributions RENAME TO authority_attributions_v22",
      );
      transaction.run(`
        CREATE TABLE authority_attributions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
          action TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
          error_code TEXT,
          occurred_at INTEGER NOT NULL
        ) STRICT
      `);
      transaction.run(
        "INSERT INTO authority_attributions SELECT * FROM authority_attributions_v22",
      );
      transaction.run("DROP TABLE authority_attributions_v22");
      transaction.run(
        "CREATE INDEX authority_attributions_keyset ON authority_attributions (occurred_at DESC, id DESC)",
      );
      transaction.run(
        "UPDATE quality_bar_metadata SET value = '22' WHERE key = 'schema_version'",
      );
      transaction.run("PRAGMA user_version = 22");
    });
    core.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(migrated.facts.schemaVersion, 49);
    assert.deepEqual(
      migrated.get(
        "SELECT id, channel, action, outcome, error_code, occurred_at FROM authority_attributions WHERE id = 'attribution-1'",
      ),
      {
        action: "login",
        channel: "browser_session",
        error_code: null,
        id: "attribution-1",
        occurred_at: 1,
        outcome: "success",
      },
    );
    migrated.run(
      `INSERT INTO authority_attributions
        (id, channel, action, outcome, error_code, occurred_at)
       VALUES ('attribution-2', 'host', 'password_recovery', 'success', NULL, 2)`,
    );
    migrated.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
