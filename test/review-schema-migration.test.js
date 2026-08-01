import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService } from "../src/review.js";

test("migrates a genuine pre-Review v5 database to Repository-scoped Assignments", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-v5-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE quality_bar_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE browser_sessions (
        session_hash TEXT PRIMARY KEY,
        csrf_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_authenticated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE authority_attributions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
        action TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
        error_code TEXT,
        occurred_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX authority_attributions_keyset
        ON authority_attributions (occurred_at DESC, id DESC);
      INSERT INTO quality_bar_metadata (key, value)
      VALUES ('schema_version', '5');
      PRAGMA user_version = 5;
    `);
    legacy.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(migrated.facts.schemaVersion, 49);
    migrated.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-1",
      "https://example.com/repository.git",
      1,
      1,
    );
    const reviews = createReviewService(migrated, {
      createId: (() => {
        let next = 0;
        return () => `v5-review-fact-${++next}`;
      })(),
      now: () => 1,
    });
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [{ impact: "blocking", instruction: "Preserve v5 facts." }],
      description: "Prove the genuine v5 migration.",
      name: "Genuine v5",
    });
    assert.deepEqual(
      reviews.setAssignment(created.id, {
        repository_ids: ["repository-1"],
        scope: "repository_set",
      }).review.assignment,
      {
        repository_ids: ["repository-1"],
        scope: "repository_set",
      },
    );
    migrated.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("migrates v6 Review facts into immutable executable snapshots with active lifecycle state", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-schema-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  try {
    const current = openDurableCore(databasePath);
    current.transaction((transaction) => {
      transaction.run(
        "INSERT INTO reviews (id, name, description, active_version_id, created_at) VALUES (?, ?, ?, ?, ?)",
        "review-1",
        "Existing Review",
        "Preserve the existing Review.",
        "review-version-1",
        1,
      );
      transaction.run(
        "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, applicability_rule, created_at, sealed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "review-version-1",
        "review-1",
        1,
        "gpt-5.6-terra",
        "high",
        "standard",
        null,
        1,
        null,
      );
      transaction.run(
        "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES (?, ?, ?, ?, ?)",
        "criterion-1",
        "review-1",
        "Preserve this instruction.",
        "blocking",
        1,
      );
      transaction.run(
        "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES (?, ?, ?, ?, ?)",
        "review-version-1",
        "criterion-1",
        1,
        "Preserve this instruction.",
        "blocking",
      );
      transaction.run(
        "UPDATE review_versions SET sealed_at = ? WHERE id = ?",
        1,
        "review-version-1",
      );
      transaction.run(
        "INSERT INTO review_assignments (review_id, scope, created_at) VALUES (?, ?, ?)",
        "review-1",
        "installation_wide",
        1,
      );
      for (const trigger of [
        "evaluation_applicability_seal_complete_update",
        "applicability_selection_rule_insert",
        "review_hard_delete_lineage",
        "review_version_criteria_immutable_update",
        "review_version_criteria_immutable_delete",
        "review_version_criteria_immutable_insert",
        "review_assignment_repository_scope_insert",
        "review_assignment_repository_scope_update",
        "review_assignment_scope_update",
        "waiver_request_advisory_insert",
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
    current.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(migrated.facts.schemaVersion, 49);
    assert.deepEqual(
      migrated.get("SELECT archived_at FROM reviews WHERE id = ?", "review-1"),
      { archived_at: null },
    );
    assert.deepEqual(
      migrated.get(
        "SELECT applicability_rule FROM review_versions WHERE id = ?",
        "review-version-1",
      ),
      { applicability_rule: null },
    );
    assert.deepEqual(
      migrated.get(
        "SELECT instruction, impact FROM review_version_criteria WHERE review_version_id = ?",
        "review-version-1",
      ),
      {
        instruction: "Preserve this instruction.",
        impact: "blocking",
      },
    );
    assert.deepEqual(
      migrated.get(
        "SELECT scope FROM review_assignments WHERE review_id = ?",
        "review-1",
      ),
      { scope: "installation_wide" },
    );
    assert.deepEqual(
      migrated.all("SELECT * FROM review_assignment_repositories"),
      [],
    );
    migrated.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
