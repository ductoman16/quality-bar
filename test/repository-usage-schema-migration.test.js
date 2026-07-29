import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService } from "../src/repository.js";
import { createReviewService } from "../src/review.js";

test("migrates genuine v24 Repository usage into an immutable deletion guard", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-v24-usage-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  for (const [id, url] of [
    ["assigned-repository", "https://example.com/assigned.git"],
    ["evaluated-repository", "https://example.com/evaluated.git"],
    [
      "formerly-assigned-repository",
      "https://example.com/formerly-assigned.git",
    ],
  ]) {
    current.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, 1, 1)",
      id,
      url,
    );
  }
  const reviews = createReviewService(current, {
    createId: (() => {
      let next = 0;
      return () => `v24-review-${++next}`;
    })(),
    now: () => 1,
  });
  const review = reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Preserve identity." }],
    description: "v24 migration fixture",
    name: "v24 migration",
  });
  reviews.setAssignment(review.id, {
    repository_ids: ["formerly-assigned-repository"],
    scope: "repository_set",
  });
  reviews.setAssignment(review.id, {
    repository_ids: ["assigned-repository"],
    scope: "repository_set",
  });
  assert.equal(
    current.get(
      `SELECT count(*) AS count
       FROM review_assignment_repositories
       WHERE repository_id = 'formerly-assigned-repository'`,
    )?.count,
    0,
  );
  current.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance, base_selector_type, base_selector_value,
       head_selector_type, head_selector_value, base_commit, head_commit,
       execution_status, created_at, completed_at
     ) VALUES (?, ?, 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'completed', 1, 1)`,
    "v24-evaluation",
    "evaluated-repository",
    "a".repeat(40),
    "b".repeat(40),
    "a".repeat(40),
    "b".repeat(40),
  );
  current.transaction((transaction) => {
    transaction.run("DROP TRIGGER repository_usage_immutable");
    transaction.run("DROP TRIGGER repository_used_by_assignment");
    transaction.run("DROP TRIGGER repository_used_by_evaluation");
    transaction.run("ALTER TABLE repositories DROP COLUMN has_been_used");
    transaction.run("ALTER TABLE repositories DROP COLUMN lifecycle_revision");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '24' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 24");
  });
  current.close();

  const migrated = openDurableCore(databasePath);
  assert.deepEqual(
    migrated.all("SELECT id, has_been_used FROM repositories ORDER BY id"),
    [
      { has_been_used: 1, id: "assigned-repository" },
      { has_been_used: 1, id: "evaluated-repository" },
      { has_been_used: 1, id: "formerly-assigned-repository" },
    ],
  );
  const repositories = createRepositoryService(migrated, {
    masterKey: Buffer.alloc(32, 9),
    async verifyRead() {},
  });
  for (const id of [
    "assigned-repository",
    "evaluated-repository",
    "formerly-assigned-repository",
  ]) {
    assert.throws(() => repositories.remove(id), {
      code: "repository_delete_unsupported",
    });
  }
  repositories.destroy();
  migrated.close();
});
