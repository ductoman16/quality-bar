import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService } from "../src/review.js";

test("Criterion edits and authored order preserve identity while prior version facts remain exact", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-criterion-identity-"),
  );
  try {
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    const reviews = createReviewService(core);
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        { impact: "blocking", instruction: "First Criterion." },
        { impact: "advisory", instruction: "Second Criterion." },
      ],
      description: "Preserve Criterion history.",
      name: "Criterion identity",
    });
    const [first, second] = created.active_version.criteria;
    assert.ok(first);
    assert.ok(second);

    const saved = reviews.saveVersion(created.id, {
      applicability_rule: null,
      codex_configuration: created.active_version.codex_configuration,
      criteria: [
        {
          id: second.id,
          impact: "blocking",
          instruction: "Edited second Criterion.",
        },
        {
          id: first.id,
          impact: "advisory",
          instruction: "Edited first Criterion.",
        },
      ],
    });

    assert.equal(saved.changed, true);
    assert.equal(saved.review.active_version.number, 2);
    assert.deepEqual(
      saved.review.active_version.criteria.map(({ id, position }) => ({
        id,
        position,
      })),
      [
        { id: second.id, position: 1 },
        { id: first.id, position: 2 },
      ],
    );
    assert.deepEqual(
      core.all(
        `SELECT
           review_versions.number,
           review_version_criteria.criterion_id,
           review_version_criteria.position,
           review_version_criteria.instruction,
           review_version_criteria.impact
         FROM review_version_criteria
         JOIN review_versions
           ON review_versions.id = review_version_criteria.review_version_id
         ORDER BY review_versions.number, review_version_criteria.position`,
      ),
      [
        {
          number: 1,
          criterion_id: first.id,
          position: 1,
          instruction: "First Criterion.",
          impact: "blocking",
        },
        {
          number: 1,
          criterion_id: second.id,
          position: 2,
          instruction: "Second Criterion.",
          impact: "advisory",
        },
        {
          number: 2,
          criterion_id: second.id,
          position: 1,
          instruction: "Edited second Criterion.",
          impact: "blocking",
        },
        {
          number: 2,
          criterion_id: first.id,
          position: 2,
          instruction: "Edited first Criterion.",
          impact: "advisory",
        },
      ],
    );
    core.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
