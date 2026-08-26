import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createReviewService } from "../src/review/review.ts";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-reactivation-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function reviewDefinition() {
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
        instruction: "Keep Review Version selection immutable.",
      },
    ],
    description: "Protect Review Version history.",
    name: "Version history",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("reactivating a compatible immutable Review Version changes only the future selection pointer", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `reactivation-fact-${++next}`;
    })(),
  });
  const created = reviews.create(reviewDefinition());
  const criterion = created.active_version.criteria[0];
  assert.ok(criterion);
  const saved = reviews.saveVersion(created.id, {
    applicability_rule: "true",
    codex_configuration: {
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      service_tier: "fast",
    },
    criteria: [
      {
        id: criterion.id,
        impact: "advisory",
        instruction: "Keep every Review Version selection immutable.",
      },
    ],
  }).review;

  const result = reviews.reactivateVersion(created.id, {
    review_version_id: created.active_version.id,
  });

  assert.equal(result.changed, true);
  assert.equal(result.review.active_version.id, created.active_version.id);
  assert.deepEqual(result.review.versions, [
    created.active_version,
    saved.active_version,
  ]);
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_versions")?.count,
    2,
  );
  assert.deepEqual(
    core.all(
      "SELECT id, active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    [{ id: created.id, active_version_id: created.active_version.id }],
  );
  core.close();
});

test("obsolete and unrelated Review Versions fail without changing the active version", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `compatibility-fact-${++next}`;
    })(),
  });
  const created = reviews.create(reviewDefinition());
  const criterion = created.active_version.criteria[0];
  assert.ok(criterion);
  core.run(
    "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, applicability_rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "obsolete-version",
    created.id,
    2,
    "obsolete-model",
    "high",
    "standard",
    null,
    1,
  );
  core.run(
    "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES (?, ?, ?, ?, ?)",
    "obsolete-version",
    criterion.id,
    1,
    criterion.instruction,
    criterion.impact,
  );
  core.run(
    "UPDATE review_versions SET sealed_at = ? WHERE id = ?",
    1,
    "obsolete-version",
  );

  assert.throws(
    () =>
      reviews.reactivateVersion(created.id, {
        review_version_id: "obsolete-version",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_model_unsupported",
  );
  assert.throws(
    () =>
      reviews.reactivateVersion(created.id, {
        review_version_id: "version-from-another-review",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_version_not_found",
  );
  assert.deepEqual(
    core.get("SELECT active_version_id FROM reviews WHERE id = ?", created.id),
    { active_version_id: created.active_version.id },
  );
  core.close();
});
