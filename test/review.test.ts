import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createReviewService, ReviewError } from "../src/review/review.ts";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

function reviewDefinition(overrides = {}) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      { impact: "blocking", instruction: "Reject unsafe SQL construction." },
    ],
    description: "Protect data access boundaries.",
    name: "Data access",
    ...overrides,
  };
}

function executableSnapshot(review: {
  active_version: {
    codex_configuration: {
      model: string;
      reasoning_effort: string;
      service_tier: string;
    };
    criteria: Array<{ id: string; impact: string; instruction: string }>;
  };
}) {
  return {
    applicability_rule: null,
    codex_configuration: review.active_version.codex_configuration,
    criteria: review.active_version.criteria.map(
      ({ id, impact, instruction }) => ({ id, impact, instruction }),
    ),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("creating a Review atomically creates its active immutable v1, stable Criterion, and installation-wide Assignment", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `review-fact-${++next}`;
    })(),
    now: () => Date.parse("2026-07-25T20:00:00.000Z"),
  });

  assert.deepEqual(reviews.create(reviewDefinition()), {
    active_version: {
      applicability_rule: null,
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        {
          id: "review-fact-3",
          impact: "blocking",
          instruction: "Reject unsafe SQL construction.",
          position: 1,
        },
      ],
      id: "review-fact-2",
      number: 1,
    },
    archived: false,
    assignment: { scope: "installation_wide" },
    deletion_eligible: true,
    description: "Protect data access boundaries.",
    id: "review-fact-1",
    name: "Data access",
    versions: [
      {
        applicability_rule: null,
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          service_tier: "standard",
        },
        criteria: [
          {
            id: "review-fact-3",
            impact: "blocking",
            instruction: "Reject unsafe SQL construction.",
            position: 1,
          },
        ],
        id: "review-fact-2",
        number: 1,
      },
    ],
  });
  assert.deepEqual(
    core.all("SELECT id, name, description, active_version_id FROM reviews"),
    [
      {
        id: "review-fact-1",
        name: "Data access",
        description: "Protect data access boundaries.",
        active_version_id: "review-fact-2",
      },
    ],
  );
  assert.deepEqual(
    core.all("SELECT review_id, scope FROM review_assignments"),
    [{ review_id: "review-fact-1", scope: "installation_wide" }],
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE review_versions SET model = ? WHERE id = ?",
        "gpt-5.6-sol",
        "review-fact-2",
      ),
    /review_version_immutable/,
  );
  assert.throws(
    () => core.run("DELETE FROM criteria WHERE id = ?", "review-fact-3"),
    /criterion_immutable/,
  );
  core.run(
    "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES (?, ?, ?, ?, ?)",
    "later-criterion",
    "review-fact-1",
    "A later Criterion must not rewrite v1.",
    "advisory",
    Date.parse("2026-07-25T20:00:00.000Z"),
  );
  assert.throws(
    () =>
      core.run(
        "INSERT INTO review_version_criteria (review_version_id, criterion_id, position) VALUES (?, ?, ?)",
        "review-fact-2",
        "later-criterion",
        2,
      ),
    /review_version_criterion_immutable/,
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE review_version_criteria SET position = ? WHERE review_version_id = ? AND criterion_id = ?",
        2,
        "review-fact-2",
        "review-fact-3",
      ),
    /review_version_criterion_immutable/,
  );
  assert.throws(
    () => reviews.create(reviewDefinition()),
    (error) =>
      error instanceof ReviewError && error.code === "review_name_conflict",
  );
  const reviewCount = core.get("SELECT count(*) AS count FROM reviews");
  assert.ok(reviewCount);
  assert.equal(reviewCount.count, 1);
  core.close();
});

test("a malformed Review definition creates no partial durable facts", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core);

  assert.throws(
    () => reviews.create(reviewDefinition({ criteria: [] })),
    (error) =>
      error instanceof ReviewError && error.code === "review_criteria_invalid",
  );
  for (const table of [
    "reviews",
    "review_versions",
    "criteria",
    "review_version_criteria",
    "review_assignments",
  ]) {
    assert.deepEqual(core.all(`SELECT * FROM ${table}`), []);
  }
  core.close();
});

test("editing Review metadata preserves the active immutable version and Criterion selection", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `metadata-fact-${++next}`;
    })(),
    now: () => Date.parse("2026-07-26T20:00:00.000Z"),
  });
  const created = reviews.create(reviewDefinition());

  const updated = reviews.updateMetadata(created.id, {
    description: "Protect every durable data boundary.",
    name: "Durable data access",
  });

  assert.deepEqual(reviews.list(), [updated]);
  assert.deepEqual(updated, {
    ...created,
    description: "Protect every durable data boundary.",
    name: "Durable data access",
  });
  assert.deepEqual(
    core.all(
      "SELECT id, name, description, active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    [
      {
        id: created.id,
        name: "Durable data access",
        description: "Protect every durable data boundary.",
        active_version_id: created.active_version.id,
      },
    ],
  );
  assert.deepEqual(
    core.all(
      "SELECT id, review_id, number, model, reasoning_effort, service_tier, created_at, sealed_at FROM review_versions",
    ),
    [
      {
        id: created.active_version.id,
        review_id: created.id,
        number: 1,
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
        created_at: Date.parse("2026-07-26T20:00:00.000Z"),
        sealed_at: Date.parse("2026-07-26T20:00:00.000Z"),
      },
    ],
  );
  assert.deepEqual(
    core.all(
      "SELECT review_version_id, criterion_id, position FROM review_version_criteria",
    ),
    [
      {
        review_version_id: created.active_version.id,
        criterion_id: created.active_version.criteria[0].id,
        position: 1,
      },
    ],
  );
  core.close();
});

test("a failed Review metadata edit changes no durable fact", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `failed-metadata-fact-${++next}`;
    })(),
  });
  const created = reviews.create(reviewDefinition());

  assert.throws(
    () =>
      reviews.updateMetadata("missing-review", {
        description: "Missing.",
        name: "Missing",
      }),
    (error) =>
      error instanceof ReviewError && error.code === "review_not_found",
  );
  assert.deepEqual(
    core.all("SELECT id, name, description, active_version_id FROM reviews"),
    [
      {
        id: created.id,
        name: created.name,
        description: created.description,
        active_version_id: created.active_version.id,
      },
    ],
  );
  core.close();
});

test("saving an unchanged executable snapshot is an explicit no-op", () => {
  const core = openDurableCore(temporaryDatabasePath());
  let timestampReads = 0;
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `noop-fact-${++next}`;
    })(),
    now: () => {
      timestampReads += 1;
      return Date.parse("2026-07-26T20:00:00.000Z");
    },
  });
  const created = reviews.create(reviewDefinition());

  const saved = reviews.saveVersion(created.id, executableSnapshot(created));

  assert.deepEqual(saved, { changed: false, review: created });
  assert.equal(timestampReads, 1);
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_versions")?.count,
    1,
  );
  core.close();
});

test("executable snapshot saves are last-write-wins against the active version", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `last-write-fact-${++next}`;
    })(),
    now: (() => {
      let next = 0;
      return () => Date.parse("2026-07-26T20:00:00.000Z") + ++next;
    })(),
  });
  const created = reviews.create(reviewDefinition());
  const openedCriterion = created.active_version.criteria[0];
  const first = reviews.saveVersion(created.id, {
    applicability_rule: "true",
    codex_configuration: created.active_version.codex_configuration,
    criteria: [
      {
        id: openedCriterion.id,
        impact: openedCriterion.impact,
        instruction: "First completed save.",
      },
    ],
  });
  const second = reviews.saveVersion(created.id, {
    applicability_rule: null,
    codex_configuration: created.active_version.codex_configuration,
    criteria: [
      {
        id: openedCriterion.id,
        impact: openedCriterion.impact,
        instruction: "Later save from an older form.",
      },
    ],
  });

  assert.equal(first.review.active_version.number, 2);
  assert.equal(second.review.active_version.number, 3);
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_versions")?.count,
    3,
  );
  const activeCriterion = second.review.active_version.criteria[0];
  assert.ok(activeCriterion);
  assert.equal(activeCriterion.instruction, "Later save from an older form.");
  assert.deepEqual(reviews.list(), [second.review]);
  core.close();
});

test("a failed executable snapshot save creates no partial or inferred version", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core);
  const created = reviews.create(reviewDefinition());

  assert.throws(
    () =>
      reviews.saveVersion(created.id, {
        applicability_rule: null,
        codex_configuration: created.active_version.codex_configuration,
        criteria: [
          {
            id: "criterion-from-another-review",
            impact: "blocking",
            instruction: "Must not be inferred.",
          },
        ],
      }),
    (error) =>
      error instanceof ReviewError &&
      error.code === "review_criterion_not_found",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_versions")?.count,
    1,
  );
  assert.deepEqual(reviews.list(), [created]);
  core.close();
});
