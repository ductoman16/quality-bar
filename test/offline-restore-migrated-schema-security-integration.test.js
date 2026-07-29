import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { verifyInstallationKey } from "../src/installation-configuration.js";
import { restoreOfflineBackup } from "../src/offline-restore.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @param {ReturnType<typeof openDurableCore>} current */
function returnSchemaToVersionSix(current) {
  current.transaction((transaction) => {
    for (const trigger of [
      "review_version_criteria_immutable_update",
      "review_version_criteria_immutable_delete",
      "review_version_criteria_immutable_insert",
      "review_assignment_repository_scope_insert",
      "review_assignment_repository_scope_update",
      "review_assignment_scope_update",
    ]) {
      transaction.run(`DROP TRIGGER ${trigger}`);
    }
    transaction.run("DROP TABLE review_assignment_repositories");
    transaction.run(
      "ALTER TABLE review_version_criteria RENAME TO review_version_criteria_v7",
    );
    transaction.run(`
      CREATE TABLE review_version_criteria (
        review_version_id TEXT NOT NULL REFERENCES review_versions(id),
        criterion_id TEXT NOT NULL REFERENCES criteria(id),
        position INTEGER NOT NULL CHECK (position > 0),
        PRIMARY KEY (review_version_id, criterion_id),
        UNIQUE (review_version_id, position)
      ) STRICT
    `);
    transaction.run(
      "INSERT INTO review_version_criteria SELECT review_version_id, criterion_id, position FROM review_version_criteria_v7",
    );
    transaction.run("DROP TABLE review_version_criteria_v7");
    transaction.run(
      "ALTER TABLE review_versions DROP COLUMN applicability_rule",
    );
    transaction.run("ALTER TABLE reviews DROP COLUMN archived_at");
    transaction.run(`
      CREATE TRIGGER review_version_criteria_immutable_update
      BEFORE UPDATE ON review_version_criteria
      BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END
    `);
    transaction.run(`
      CREATE TRIGGER review_version_criteria_immutable_delete
      BEFORE DELETE ON review_version_criteria
      BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END
    `);
    transaction.run(`
      CREATE TRIGGER review_version_criteria_immutable_insert
      BEFORE INSERT ON review_version_criteria
      WHEN (
        SELECT sealed_at FROM review_versions
        WHERE id = NEW.review_version_id
      ) IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'review_version_criterion_immutable'); END
    `);
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '6' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 6");
  });
}

test("restores a compatible current snapshot produced by the genuine v6 migration", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-migrated-schema-"),
  );
  try {
    const databasePath = join(directory, "quality-bar.sqlite3");
    const backupsPath = join(directory, "backups");
    const masterKey = Buffer.alloc(32, 7);
    const current = openDurableCore(databasePath);
    verifyInstallationKey(current, masterKey);
    bootstrapOperatorPassword(current, "the snapshot operator password");
    returnSchemaToVersionSix(current);
    current.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(migrated.facts.schemaVersion, 25);
    assert.match(
      String(
        migrated.get(
          `SELECT sql
             FROM sqlite_schema
            WHERE name = 'review_version_criteria_immutable_insert'`,
        )?.sql,
      ),
      /WHEN \(\s+SELECT/,
    );
    migrated.close();

    const source = new DatabaseSync(databasePath);
    const backup = await createValidatedBackup({
      applicationVersion: "0.1.0",
      backupsPath,
      database: source,
      keyIdentity: installationKeyIdentity(masterKey),
      kind: "daily",
    });
    source.close();
    const postBackup = openDurableCore(databasePath);
    postBackup.run(
      "INSERT INTO quality_bar_metadata (key, value) VALUES ('post_backup_fact', 'must-disappear')",
    );
    postBackup.close();

    await restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    });

    const restored = openDurableCore(databasePath);
    assert.equal(
      restored.get(
        "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
      ),
      undefined,
    );
    restored.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
