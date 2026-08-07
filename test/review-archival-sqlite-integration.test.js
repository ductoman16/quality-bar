import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService } from "../src/review.js";

test("archiving excludes a Review from future selection and restoring preserves its pointer and history", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-archival-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    let timestampReads = 0;
    const reviews = createReviewService(core, {
      createId: (() => {
        let next = 0;
        return () => `archival-fact-${++next}`;
      })(),
      now: () => {
        timestampReads += 1;
        return Date.parse(`2026-07-${25 + timestampReads}T20:00:00.000Z`);
      },
    });
    core.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-1",
      "https://example.com/repository.git",
      1,
      1,
    );
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        {
          impact: "blocking",
          instruction: "Preserve Review history.",
        },
      ],
      description: "Keep Review lifecycle changes narrow.",
      name: "Review lifecycle",
    });
    const criterion = created.active_version.criteria[0];
    assert.ok(criterion);
    const saved = reviews.saveVersion(created.id, {
      applicability_rule: null,
      codex_configuration: created.active_version.codex_configuration,
      criteria: [
        {
          id: criterion.id,
          impact: criterion.impact,
          instruction: "Preserve complete Review history.",
        },
      ],
    }).review;
    const before = {
      assignment: core.all("SELECT * FROM review_assignments"),
      criteria: core.all("SELECT * FROM criteria"),
      versionCriteria: core.all("SELECT * FROM review_version_criteria"),
      versions: core.all("SELECT * FROM review_versions"),
    };
    const existingEvaluationSelection =
      reviews.selectForNewEvaluation("repository-1");

    const archived = reviews.setArchived(created.id, { archived: true });

    assert.equal(archived.changed, true);
    assert.equal(archived.review.archived, true);
    assert.equal(archived.review.active_version.id, saved.active_version.id);
    assert.deepEqual(archived.review.versions, saved.versions);
    assert.deepEqual(reviews.list(), []);
    assert.deepEqual(reviews.list("archived"), [archived.review]);
    assert.deepEqual(reviews.selectForNewEvaluation("repository-1"), []);
    assert.deepEqual(existingEvaluationSelection, [
      {
        review_id: created.id,
        review_version_id: saved.active_version.id,
      },
    ]);
    assert.deepEqual(
      core.get(
        "SELECT active_version_id, archived_at FROM reviews WHERE id = ?",
        created.id,
      ),
      {
        active_version_id: saved.active_version.id,
        archived_at: Date.parse("2026-07-28T20:00:00.000Z"),
      },
    );
    assert.deepEqual(
      {
        assignment: core.all("SELECT * FROM review_assignments"),
        criteria: core.all("SELECT * FROM criteria"),
        versionCriteria: core.all("SELECT * FROM review_version_criteria"),
        versions: core.all("SELECT * FROM review_versions"),
      },
      before,
    );

    assert.deepEqual(reviews.setArchived(created.id, { archived: true }), {
      changed: false,
      review: archived.review,
    });
    assert.equal(timestampReads, 3);

    const restored = reviews.setArchived(created.id, { archived: false });

    assert.equal(restored.changed, true);
    assert.equal(restored.review.archived, false);
    assert.equal(restored.review.active_version.id, saved.active_version.id);
    assert.deepEqual(restored.review.versions, saved.versions);
    assert.deepEqual(reviews.list(), [restored.review]);
    assert.deepEqual(reviews.list("archived"), []);
    assert.deepEqual(reviews.selectForNewEvaluation("repository-1"), [
      {
        review_id: created.id,
        review_version_id: saved.active_version.id,
      },
    ]);
    assert.equal(timestampReads, 3);
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
