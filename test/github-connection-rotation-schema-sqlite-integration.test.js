import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GITHUB_CONNECTION_SCHEMA } from "../src/github-connection-schema.js";
import { currentGitHubConnectionRotationMigration } from "../src/github-connection-schema-migration.js";

/** @param {string} databasePath @param {number} schemaVersion */
function downgradeVerificationSchema(databasePath, schemaVersion) {
  const database = new DatabaseSync(databasePath);
  const legacySchema = GITHUB_CONNECTION_SCHEMA.replace(
    "trigger IN ('onboarding', 'repository_selection', 'enablement', 'rotation')",
    "trigger IN ('onboarding', 'repository_selection', 'enablement')",
  );
  database.exec(
    `PRAGMA foreign_keys = OFF;
     PRAGMA legacy_alter_table = ON;
     DROP TRIGGER IF EXISTS github_connection_verification_checks_valid;
     DROP TRIGGER IF EXISTS github_connection_verification_immutable_update;
     DROP TRIGGER IF EXISTS github_connection_verification_immutable_delete;
     ALTER TABLE github_connection_verifications
       RENAME TO github_connection_verifications_v48;
     ${legacySchema}
     INSERT INTO github_connection_verifications
       SELECT * FROM github_connection_verifications_v48;
     DROP TABLE github_connection_verifications_v48;
     UPDATE quality_bar_metadata SET value = '${schemaVersion}'
      WHERE key = 'schema_version';
     PRAGMA user_version = ${schemaVersion};`,
  );
  database.close();
}

test("GitHub rotation repair waits for the post-health verification shape", () => {
  const database = /** @type {any} */ ({
    prepare(/** @type {string} */ sql) {
      return sql.startsWith("SELECT sql")
        ? {
            get: () => ({
              sql: "CREATE TABLE github_connection_verifications (id TEXT)",
            }),
          }
        : { all: () => [{ name: "id" }] };
    },
  });
  assert.equal(currentGitHubConnectionRotationMigration(database, 48, 48), "");
});

test("GitHub rotation schema repair preserves current history and dependent foreign keys", async (context) => {
  for (const schemaVersion of [47, 48]) {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-github-rotation-schema-${schemaVersion}-`),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const databasePath = join(directory, "quality-bar.sqlite3");
    const core = openDurableCore(databasePath);
    core.run(
      `INSERT INTO github_connections (
         id, app_id, app_slug, installation_id, principal_id,
         principal_login, api_profile, permissions, capabilities,
         repository_count, created_at, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "connection-1",
      47,
      "quality-bar-personal",
      73,
      91,
      "operator",
      "github-rest:2026-03-10",
      JSON.stringify({ contents: "read" }),
      JSON.stringify({ private_git_read: "verified" }),
      1,
      1_000,
      1_000,
    );
    core.run(
      `INSERT INTO github_connection_verifications (
         id, connection_id, trigger, outcome, error_code, error_message,
         error_repository_id, api_profile, principal_id, principal_login,
         permissions, capabilities, affected_repository_ids,
         repository_checks, repositories, verified_at
       ) VALUES (?, ?, 'onboarding', 'success', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "verification-1",
      "connection-1",
      "github-rest:2026-03-10",
      91,
      "operator",
      JSON.stringify({ contents: "read" }),
      JSON.stringify({ private_git_read: "verified" }),
      JSON.stringify([101]),
      JSON.stringify([{ repository_id: 101, outcome: "success" }]),
      JSON.stringify([{ id: 101 }]),
      1_000,
    );
    core.close();
    downgradeVerificationSchema(databasePath, schemaVersion);
    const reopened = openDurableCore(databasePath);
    assert.equal(
      reopened.get(
        "SELECT count(*) AS count FROM github_connection_verifications",
      )?.count,
      1,
    );
    assert.match(
      /** @type {string} */ (
        reopened.get(
          "SELECT sql FROM sqlite_schema WHERE name = 'github_connection_verifications'",
        )?.sql
      ),
      /'rotation'/,
    );
    assert.doesNotMatch(
      /** @type {string} */ (
        reopened.get(
          "SELECT sql FROM sqlite_schema WHERE name = 'github_repositories'",
        )?.sql
      ),
      /github_connection_verifications_v48/,
    );
    reopened.close();
  }
});
