import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createReviewService } from "../src/review/review.js";

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

test("retiring and replacing a Criterion preserves its identity and complete history", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-criterion-retirement-"),
  );
  try {
    let nextId = 0;
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    const reviews = createReviewService(core, {
      createId() {
        nextId += 1;
        return `identity-${nextId}`;
      },
      now: () => 1_800_000_000_000 + nextId,
    });
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        { impact: "blocking", instruction: "Retire this meaning." },
        { impact: "advisory", instruction: "Keep this Criterion." },
      ],
      description: "Preserve retired Criterion history.",
      name: "Criterion retirement",
    });
    const [retired, retained] = created.active_version.criteria;
    assert.ok(retired);
    assert.ok(retained);

    const saved = reviews.saveVersion(created.id, {
      applicability_rule: null,
      codex_configuration: created.active_version.codex_configuration,
      criteria: [
        {
          id: retained.id,
          impact: retained.impact,
          instruction: retained.instruction,
        },
        {
          impact: "blocking",
          instruction: "Use this replacement meaning.",
        },
      ],
    });

    assert.equal(saved.changed, true);
    assert.equal(saved.review.active_version.number, 2);
    assert.equal(saved.review.active_version.criteria[0]?.id, retained.id);
    const replacement = saved.review.active_version.criteria[1];
    assert.ok(replacement);
    assert.notEqual(replacement.id, retired.id);
    assert.deepEqual(
      core.all(
        `SELECT id, instruction
         FROM criteria
         WHERE review_id = ?
         ORDER BY created_at, id`,
        created.id,
      ),
      [
        { id: retired.id, instruction: "Retire this meaning." },
        { id: retained.id, instruction: "Keep this Criterion." },
        {
          id: replacement.id,
          instruction: "Use this replacement meaning.",
        },
      ],
    );
    assert.deepEqual(
      core.all(
        `SELECT
           review_versions.number,
           review_version_criteria.criterion_id
         FROM review_version_criteria
         JOIN review_versions
           ON review_versions.id = review_version_criteria.review_version_id
         ORDER BY review_versions.number, review_version_criteria.position`,
      ),
      [
        { number: 1, criterion_id: retired.id },
        { number: 1, criterion_id: retained.id },
        { number: 2, criterion_id: retained.id },
        { number: 2, criterion_id: replacement.id },
      ],
    );
    assert.throws(
      () => core.run("DELETE FROM criteria WHERE id = ?", retired.id),
      /criterion_immutable/,
    );
    core.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a replacement identity collision fails atomically instead of reusing history", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-criterion-collision-"),
  );
  try {
    const identifiers = [
      "review",
      "version-1",
      "retired",
      "retained",
      "version-2",
      "retired",
    ];
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    const reviews = createReviewService(core, {
      createId() {
        const id = identifiers.shift();
        if (!id) {
          throw new Error("unexpected identity request");
        }
        return id;
      },
      now: () => 1_800_000_000_000,
    });
    const created = reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        { impact: "blocking", instruction: "Retire this meaning." },
        { impact: "advisory", instruction: "Keep this Criterion." },
      ],
      description: "Reject identity collisions.",
      name: "Criterion collision",
    });

    assert.throws(
      () =>
        reviews.saveVersion(created.id, {
          applicability_rule: null,
          codex_configuration: created.active_version.codex_configuration,
          criteria: [
            {
              id: "retained",
              impact: "advisory",
              instruction: "Keep this Criterion.",
            },
            {
              impact: "blocking",
              instruction: "Use the replacement meaning.",
            },
          ],
        }),
      /UNIQUE constraint failed: criteria\.id/,
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM review_versions")?.count,
      1,
    );
    assert.equal(core.get("SELECT count(*) AS count FROM criteria")?.count, 2);
    assert.deepEqual(reviews.list(), [created]);
    core.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
