import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import {
  createEvaluationService,
  EvaluationError,
} from "../src/evaluation/evaluation.js";
import { createReviewService } from "../src/review/review.js";

const request = {
  base: { type: "branch", value: "main" },
  head: { type: "branch", value: "topic" },
};

/** @param {string} name */
function reviewDefinition(name) {
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
        instruction: `Prove ${name} admission.`,
      },
    ],
    description: "Review Run admission proof",
    name,
  };
}

test("Review Runs, queue rows, Evaluation, and idempotency commit atomically within capacity", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-admission-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let factId = 0;
  const reviews = createReviewService(core, {
    createId: () => `review-fact-${++factId}`,
    now: () => 1,
  });
  reviews.create(reviewDefinition("first"));

  let evaluationId = 0;
  let reviewRunId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => `evaluation-${++evaluationId}`,
    createReviewRunId: () => `review-run-${++reviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });

  for (let index = 1; index <= 24; index += 1) {
    const accepted = await evaluations.createExplicit({
      channel: "browser_session",
      idempotencyKey: `accepted-${index}`,
      repositoryId: "repository-1",
      request,
    });
    assert.equal(accepted.resource.execution_status, "queued");
  }
  reviews.create(reviewDefinition("second"));

  await assert.rejects(
    () =>
      evaluations.createExplicit({
        channel: "mcp",
        idempotencyKey: "reusable-after-capacity",
        repositoryId: "repository-1",
        request,
      }),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "capacity_unavailable" &&
      error.message === "Codex execution capacity is unavailable",
  );
  assert.deepEqual(
    core.get("SELECT count(*) AS count FROM codex_execution_queue"),
    { count: 24 },
  );
  assert.deepEqual(core.get("SELECT count(*) AS count FROM review_runs"), {
    count: 24,
  });
  assert.deepEqual(core.get("SELECT count(*) AS count FROM evaluations"), {
    count: 24,
  });
  assert.equal(
    core.get(
      "SELECT idempotency_key FROM evaluation_idempotency WHERE idempotency_key = ?",
      "reusable-after-capacity",
    ),
    undefined,
  );
  core.run(
    `UPDATE codex_execution_queue
     SET started_at = 11
     WHERE work_id = (
       SELECT work_id FROM codex_execution_queue
       ORDER BY ready_at, work_id LIMIT 1
     )`,
  );
  const acceptedAfterCapacity = await evaluations.createExplicit({
    channel: "mcp",
    idempotencyKey: "reusable-after-capacity",
    repositoryId: "repository-1",
    request,
  });
  assert.equal(acceptedAfterCapacity.resource.execution_status, "queued");
  assert.deepEqual(
    core.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
    ),
    { count: 25 },
  );
  assert.deepEqual(core.get("SELECT count(*) AS count FROM review_runs"), {
    count: 26,
  });
  assert.deepEqual(core.get("SELECT count(*) AS count FROM evaluations"), {
    count: 25,
  });
});

test("a new key admits a distinct same-Changeset Evaluation from current Review facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-rerun-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let reviewFact = 0;
  const reviews = createReviewService(core, {
    createId: () => `rerun-review-fact-${++reviewFact}`,
    now: () => reviewFact,
  });
  const review = reviews.create(reviewDefinition("intentional rerun"));
  let evaluationId = 0;
  let reviewRunId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => `rerun-evaluation-${++evaluationId}`,
    createReviewRunId: () => `rerun-review-run-${++reviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const input = {
    channel: /** @type {"implementer_token"} */ ("implementer_token"),
    repositoryId: "repository-1",
    request,
  };
  const first = await evaluations.createExplicit({
    ...input,
    idempotencyKey: "first-key",
  });
  reviews.setAssignment(review.id, {
    repository_ids: ["repository-1"],
    scope: "repository_set",
  });
  const current = reviews.saveVersion(review.id, {
    applicability_rule: null,
    codex_configuration: review.active_version.codex_configuration,
    criteria: review.active_version.criteria.map((criterion) => ({
      id: criterion.id,
      impact: criterion.impact,
      instruction: "Review this Changeset with the current version.",
    })),
  }).review;
  const second = await evaluations.createExplicit({
    ...input,
    idempotencyKey: "intentional-rerun-key",
  });

  assert.notEqual(first.resource.id, second.resource.id);
  assert.deepEqual(
    [first.resource, second.resource].map(({ base_commit, head_commit }) => ({
      base_commit,
      head_commit,
    })),
    [
      { base_commit: "1".repeat(40), head_commit: "2".repeat(40) },
      { base_commit: "1".repeat(40), head_commit: "2".repeat(40) },
    ],
  );
  assert.deepEqual(
    core.all(
      `SELECT evaluation_id, review_version_id, assignment_scope
       FROM applicability_selections
       ORDER BY evaluation_id`,
    ),
    [
      {
        assignment_scope: "installation_wide",
        evaluation_id: "rerun-evaluation-1",
        review_version_id: review.active_version.id,
      },
      {
        assignment_scope: "repository_specific",
        evaluation_id: "rerun-evaluation-2",
        review_version_id: current.active_version.id,
      },
    ],
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_idempotency")?.count,
    2,
  );
});
