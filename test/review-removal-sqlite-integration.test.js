import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService } from "../src/review.js";

/** @param {string} name */
function definition(name) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Preserve immutable Review history.",
      },
    ],
    description: "Review deletion proof",
    name,
  };
}

test("SQLite deletes a complete never-used Review lineage and preserves every used lineage fact", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-delete-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  let nextId = 0;
  const reviews = createReviewService(core, {
    createId: () => `review-delete-fact-${++nextId}`,
    now: () => 1,
  });

  const unused = reviews.create(definition("Never used"));
  const unusedCriterion = unused.active_version.criteria[0];
  assert.ok(unusedCriterion);
  const unusedSaved = reviews.saveVersion(unused.id, {
    applicability_rule: null,
    codex_configuration: unused.active_version.codex_configuration,
    criteria: [
      {
        id: unusedCriterion.id,
        impact: unusedCriterion.impact,
        instruction: "Preserve the entire immutable Review lineage.",
      },
    ],
  }).review;
  assert.equal(unusedSaved.deletion_eligible, true);
  assert.throws(
    () =>
      core.run(
        "DELETE FROM review_versions WHERE id = ?",
        unused.active_version.id,
      ),
    /review_version_immutable/,
  );

  reviews.remove(unused.id, {});

  for (const table of [
    "reviews",
    "review_assignments",
    "review_assignment_repositories",
    "review_versions",
    "criteria",
    "review_version_criteria",
  ]) {
    assert.equal(
      core.get(`SELECT count(*) AS count FROM ${table}`)?.count,
      0,
      table,
    );
  }

  const used = reviews.create(definition("Already used"));
  const usedCriterion = used.active_version.criteria[0];
  assert.ok(usedCriterion);
  const usedSaved = reviews.saveVersion(used.id, {
    applicability_rule: null,
    codex_configuration: used.active_version.codex_configuration,
    criteria: [
      {
        id: usedCriterion.id,
        impact: usedCriterion.impact,
        instruction: "Preserve every used Review lineage fact.",
      },
    ],
  }).review;
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-review-delete",
    "https://example.invalid/review-delete.git",
    1,
    1,
  );
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance, base_selector_type, base_selector_value,
       head_selector_type, head_selector_value, base_commit, head_commit,
       execution_status, created_at
     ) VALUES (?, ?, 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'queued', ?)`,
    "evaluation-review-delete",
    "repository-review-delete",
    "a".repeat(40),
    "b".repeat(40),
    "a".repeat(40),
    "b".repeat(40),
    2,
  );
  core.run(
    `INSERT INTO review_runs (
       id, evaluation_id, review_id, review_version_id,
       execution_status, created_at
     ) VALUES (?, ?, ?, ?, 'queued', ?)`,
    "review-run-delete",
    "evaluation-review-delete",
    used.id,
    used.active_version.id,
    2,
  );

  assert.equal(reviews.list()[0]?.deletion_eligible, false);
  assert.throws(() => reviews.remove(used.id, {}), {
    code: "review_delete_unsupported",
    message: "A used Review must be archived",
  });
  assert.deepEqual(
    core.get(
      "SELECT review_id, review_version_id FROM review_runs WHERE id = ?",
      "review-run-delete",
    ),
    {
      review_id: used.id,
      review_version_id: used.active_version.id,
    },
  );
  assert.deepEqual(
    core.all(
      "SELECT id FROM review_versions WHERE review_id = ? ORDER BY number",
      used.id,
    ),
    usedSaved.versions.map(({ id }) => ({ id })),
  );
});

test("the hard-delete marker transition cannot commit a partial Review lineage", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-guard-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  let nextId = 0;
  const reviews = createReviewService(core, {
    createId: () => `review-delete-guard-${++nextId}`,
    now: () => 1,
  });
  const review = reviews.create(definition("Guarded lineage"));
  const criterion = review.active_version.criteria[0];
  assert.ok(criterion);
  reviews.saveVersion(review.id, {
    applicability_rule: null,
    codex_configuration: review.active_version.codex_configuration,
    criteria: [
      {
        id: criterion.id,
        impact: criterion.impact,
        instruction: "A marker cannot authorize partial history deletion.",
      },
    ],
  });
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM review_versions WHERE review_id = ?",
      review.id,
    )?.count,
    2,
  );
  assert.throws(
    () =>
      core.run(
        `INSERT INTO reviews (
           id, name, description, active_version_id, archived_at,
           hard_delete_pending, created_at
         ) VALUES (?, ?, ?, ?, NULL, 1, ?)`,
        "forged-marker-review",
        "Forged marker Review",
        "A Review cannot begin with deletion authorization.",
        "missing-version",
        1,
      ),
    /review_hard_delete_marker_invalid/,
  );

  core.run(
    "UPDATE reviews SET hard_delete_pending = 1 WHERE id = ?",
    review.id,
  );

  for (const table of [
    "reviews",
    "review_assignments",
    "review_assignment_repositories",
    "review_versions",
    "criteria",
    "review_version_criteria",
  ]) {
    assert.equal(
      core.get(`SELECT count(*) AS count FROM ${table}`)?.count,
      0,
      table,
    );
  }
});
