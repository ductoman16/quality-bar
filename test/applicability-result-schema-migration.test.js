import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  EXPECTED_SCHEMA_TABLES,
  finalizeSchemaMigration,
} from "../src/durable-schema-migration.js";

test("schema v30 adds Applicability Results without inventing historical facts", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.transaction((transaction) => {
    transaction.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-1",
      "https://example.invalid/repository.git",
      1,
      1,
    );
    transaction.run(
      `INSERT INTO evaluations (
         id, repository_id, provenance,
         base_selector_type, base_selector_value,
         head_selector_type, head_selector_value,
         base_commit, head_commit, execution_status, created_at
       ) VALUES (?, ?, 'explicit', 'branch', 'main', 'branch', 'topic', ?, ?, 'completed', ?)`,
      "evaluation-historical",
      "repository-1",
      "1".repeat(40),
      "2".repeat(40),
      50,
    );
    transaction.run(
      "DROP TRIGGER evaluation_applicability_seal_complete_update",
    );
    transaction.run("DROP TRIGGER applicability_result_immutable_update");
    transaction.run("DROP TRIGGER applicability_result_immutable_delete");
    transaction.run("DROP TABLE applicability_results");
    transaction.run("DROP TABLE applicability_selections");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '30' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 30");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 53);
  assert.deepEqual(
    migrated.get("SELECT count(*) AS count FROM applicability_results"),
    { count: 0 },
  );
  assert.deepEqual(
    migrated.get(
      `SELECT name FROM pragma_table_info('evaluations')
       WHERE name = 'applicability_sealed_at'`,
    ),
    { name: "applicability_sealed_at" },
  );
  assert.deepEqual(
    migrated.get(
      "SELECT applicability_sealed_at FROM evaluations WHERE id = ?",
      "evaluation-historical",
    ),
    { applicability_sealed_at: 50 },
  );
  assert.throws(
    () =>
      migrated.run(
        `INSERT INTO applicability_selections (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source
         ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL)`,
        "evaluation-historical",
        "review-historical",
        "review-version-historical",
      ),
    /applicability_result_insertion_closed/,
  );
  assert.throws(
    () =>
      migrated.run(
        `INSERT INTO applicability_results (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source, outcome, evidence_json
         ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL, 'applicable', ?)`,
        "evaluation-historical",
        "review-historical",
        "review-version-historical",
        '{"kind":"unconditional"}',
      ),
    /applicability_result_insertion_closed/,
  );
});

test("schema v52 preserves an active Evaluation with unsealed Applicability", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.transaction((transaction) => {
    transaction.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-1",
      "https://example.invalid/repository.git",
      1,
      1,
    );
    transaction.run(
      "INSERT INTO reviews (id, name, description, archived_at, active_version_id, hard_delete_pending, created_at) VALUES ('review-1', 'Review', 'Description', NULL, 'version-1', 0, 1)",
    );
    transaction.run(
      "INSERT INTO review_versions (id, review_id, number, applicability_rule, model, reasoning_effort, service_tier, created_at, sealed_at) VALUES ('version-1', 'review-1', 1, NULL, 'gpt-5.6-terra', 'high', 'standard', 1, 1)",
    );
    transaction.run(
      "INSERT INTO review_assignments (review_id, scope, created_at) VALUES ('review-1', 'installation_wide', 1)",
    );
    transaction.run(
      `INSERT INTO evaluations (
         id, repository_id, provenance,
         base_selector_type, base_selector_value,
         head_selector_type, head_selector_value,
         base_commit, head_commit, execution_status, created_at
      ) VALUES (?, ?, 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'queued', ?)`,
      "evaluation-active",
      "repository-1",
      "1".repeat(40),
      "2".repeat(40),
      "1".repeat(40),
      "2".repeat(40),
      50,
    );
    transaction.run("DROP TABLE onboarding_tokens");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '52' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 52");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 53);
  assert.deepEqual(
    migrated.get(
      "SELECT applicability_sealed_at FROM evaluations WHERE id = ?",
      "evaluation-active",
    ),
    { applicability_sealed_at: null },
  );
});

test("schema v30 migration adds the Applicability authority seal when absent", () => {
  let migration = "";
  let metadataReads = 0;
  finalizeSchemaMigration(
    /** @type {any} */ ({
      /** @param {string} statements */
      exec(statements) {
        if (
          statements.includes("ALTER TABLE") ||
          statements.includes("UPDATE evaluations")
        ) {
          migration = statements;
        }
      },
      function() {},
      /** @param {string} sql */
      prepare(sql) {
        return {
          all() {
            if (sql.includes("name NOT LIKE 'sqlite_%'")) {
              return [...EXPECTED_SCHEMA_TABLES].map((name) => ({ name }));
            }
            return sql.includes("evaluations") ||
              sql.includes("review_run_pre_start_") ||
              sql.includes("evaluation_pre_start_") ||
              sql.includes("waiver_adjudication_") ||
              sql.includes("waiver_recovery_")
              ? []
              : [{ name: "has_been_used" }];
          },
          get() {
            if (sql.includes("PRAGMA user_version")) {
              return { user_version: 53 };
            }
            if (sql.includes("PRAGMA integrity_check")) {
              return { integrity_check: "ok" };
            }
            if (sql.includes("PRAGMA foreign_key_check")) {
              return undefined;
            }
            return sql.includes("quality_bar_metadata")
              ? { value: metadataReads++ === 0 ? "30" : "53" }
              : undefined;
          },
        };
      },
    }),
    30,
  );
  assert.match(
    migration,
    /ALTER TABLE evaluations ADD COLUMN applicability_sealed_at INTEGER;/,
  );
  assert.match(
    migration,
    /SET applicability_sealed_at = created_at\s+WHERE applicability_sealed_at IS NULL;/,
  );
});
