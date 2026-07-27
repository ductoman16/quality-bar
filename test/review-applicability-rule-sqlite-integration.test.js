import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService, ReviewError } from "../src/review.js";

/** @param {ReturnType<typeof createReviewService>} reviews */
function createReview(reviews) {
  return reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Keep Applicability deterministic.",
      },
    ],
    description: "Compile every Applicability Rule before it is durable.",
    name: "Restricted CEL",
  });
}

test("a Review Version saves only after its restricted CEL rule compiles atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-cel-sqlite-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `cel-fact-${++next}`;
    })(),
  });
  const created = createReview(reviews);
  const criterion = created.active_version.criteria[0];
  assert.ok(criterion);
  const authoredCriterion = {
    id: criterion.id,
    impact: criterion.impact,
    instruction: criterion.instruction,
  };
  const saved = reviews.saveVersion(created.id, {
    applicability_rule:
      'file_changes.exists(file, file.modified && file.paths.exists(path, path.matches(":(glob)src/**")))',
    codex_configuration: created.active_version.codex_configuration,
    criteria: [authoredCriterion],
  });
  const durableBeforeFailure = {
    activeVersion: core.get(
      "SELECT active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    versions: core.all(
      "SELECT id, applicability_rule FROM review_versions WHERE review_id = ? ORDER BY number",
      created.id,
    ),
  };

  assert.throws(
    () =>
      reviews.saveVersion(created.id, {
        applicability_rule:
          "file_changes.exists(file, file.modified) && true || false",
        codex_configuration: created.active_version.codex_configuration,
        criteria: [authoredCriterion],
      }),
    (error) =>
      error instanceof ReviewError &&
      error.code === "review_applicability_rule_parentheses_required",
  );
  assert.deepEqual(
    {
      activeVersion: core.get(
        "SELECT active_version_id FROM reviews WHERE id = ?",
        created.id,
      ),
      versions: core.all(
        "SELECT id, applicability_rule FROM review_versions WHERE review_id = ? ORDER BY number",
        created.id,
      ),
    },
    durableBeforeFailure,
  );
  assert.equal(
    saved.review.active_version.id,
    durableBeforeFailure.activeVersion?.active_version_id,
  );
  core.close();
  rmSync(directory, { force: true, recursive: true });
});
