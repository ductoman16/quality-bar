import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService } from "../src/review.js";

const temporaryDirectories = [];

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
    criteria: [{ impact: "blocking", instruction: "Reject unsafe SQL construction." }],
    description: "Protect data access boundaries.",
    name: "Data access",
    ...overrides,
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
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [{ id: "review-fact-3", impact: "blocking", instruction: "Reject unsafe SQL construction.", position: 1 }],
      id: "review-fact-2",
      number: 1,
    },
    assignment: { scope: "installation_wide" },
    description: "Protect data access boundaries.",
    id: "review-fact-1",
    name: "Data access",
  });
  assert.deepEqual(
    core.all("SELECT id, name, description, active_version_id FROM reviews"),
    [{ id: "review-fact-1", name: "Data access", description: "Protect data access boundaries.", active_version_id: "review-fact-2" }],
  );
  assert.deepEqual(
    core.all("SELECT review_id, scope FROM review_assignments"),
    [{ review_id: "review-fact-1", scope: "installation_wide" }],
  );
  assert.throws(
    () => core.run("UPDATE review_versions SET model = ? WHERE id = ?", "gpt-5.6-sol", "review-fact-2"),
    /review_version_immutable/,
  );
  assert.throws(
    () => core.run("DELETE FROM criteria WHERE id = ?", "review-fact-3"),
    /criterion_immutable/,
  );
  assert.throws(
    () => reviews.create(reviewDefinition()),
    (error) => error.code === "review_name_conflict",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM reviews").count, 1);
  core.close();
});

test("a malformed Review definition creates no partial durable facts", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const reviews = createReviewService(core);

  assert.throws(
    () => reviews.create(reviewDefinition({ criteria: [] })),
    (error) => error.code === "review_criteria_invalid",
  );
  for (const table of ["reviews", "review_versions", "criteria", "review_version_criteria", "review_assignments"]) {
    assert.deepEqual(core.all(`SELECT * FROM ${table}`), []);
  }
  core.close();
});
