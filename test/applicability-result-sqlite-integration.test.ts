import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createReviewService } from "../src/review/review.ts";

function definition(name: string) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: `Prove ${name}.` }],
    description: `${name} applicability`,
    name,
  };
}

function createAssignedReview(
  reviews: ReturnType<typeof createReviewService>,
  name: string,
  applicabilityRule: string | null,
) {
  const created = reviews.create(definition(name));
  if (applicabilityRule === null) {
    return created;
  }
  return reviews.saveVersion(created.id, {
    applicability_rule: applicabilityRule,
    codex_configuration: created.active_version.codex_configuration,
    criteria: created.active_version.criteria.map((criterion) => ({
      id: criterion.id,
      impact: criterion.impact,
      instruction: criterion.instruction,
    })),
  }).review;
}

test("every assigned Review persists one Applicability Result and only applicable versions queue once", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
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
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `fact-${++fact}`,
    now: () => fact,
  });
  const unconditional = createAssignedReview(reviews, "unconditional", null);
  const applicable = createAssignedReview(reviews, "applicable", "true");
  createAssignedReview(reviews, "not applicable", "false");
  createAssignedReview(
    reviews,
    "material unavailable",
    "file_changes.exists(file, file.added)",
  );

  let run = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-1",
    createReviewRunId: () => `review-run-${++run}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const created = await evaluations.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "applicability",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  assert.equal(created.resource.execution_status, "queued");
  assert.deepEqual(
    core
      .all(
        `SELECT outcome, rule_source, error_code
         FROM applicability_results`,
      )
      .toSorted((left: any, right: any) =>
        String(left?.rule_source).localeCompare(String(right?.rule_source)),
      ),
    [
      { error_code: null, outcome: "applicable", rule_source: null },
      { error_code: null, outcome: "applicable", rule_source: "true" },
      { error_code: null, outcome: "not_applicable", rule_source: "false" },
      {
        error_code: "applicability_file_changes_unavailable",
        outcome: "error",
        rule_source: "file_changes.exists(file, file.added)",
      },
    ].toSorted((left: any, right: any) =>
      String(left.rule_source).localeCompare(String(right.rule_source)),
    ),
  );
  assert.deepEqual(
    core.all(
      `SELECT review_runs.review_id, review_runs.review_version_id
       FROM review_runs ORDER BY review_runs.review_id`,
    ),
    [
      {
        review_id: applicable.id,
        review_version_id: applicable.active_version.id,
      },
      {
        review_id: unconditional.id,
        review_version_id: unconditional.active_version.id,
      },
    ].toSorted((left: any, right: any) =>
      String(left.review_id).localeCompare(String(right.review_id)),
    ),
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM codex_execution_queue")?.count,
    2,
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE applicability_results SET outcome = 'not_applicable' WHERE evaluation_id = 'evaluation-1'",
      ),
    /applicability_result_immutable/,
  );
  assert.deepEqual(
    core.get(
      "SELECT applicability_sealed_at FROM evaluations WHERE id = 'evaluation-1'",
    ),
    { applicability_sealed_at: 100 },
  );
});

test("successful terminal applicability with no selected runs creates one complete Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
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
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `fact-${++fact}`,
    now: () => fact,
  });
  createAssignedReview(reviews, "not applicable", "false");
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-1",
    readCodexCapabilityFailure: () =>
      Object.assign(new Error("Codex must not be required"), {
        code: "codex_authentication_unavailable",
      }),
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const created = await evaluations.createExplicit({
    channel: "browser_session",
    idempotencyKey: "not-applicable",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  assert.equal(created.resource.execution_status, "completed");
  assert.equal(created.resource.effective_outcome, "clear");
  assert.equal(evaluations.readResult("evaluation-1").outcome, "clear");
  assert.equal(
    evaluations.readResult("evaluation-1").applicability_results[0].outcome,
    "not_applicable",
  );
});

test("terminal Applicability error retains its exact predicate context without a partial run", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
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
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `fact-${++fact}`,
    now: () => fact,
  });
  const review = createAssignedReview(
    reviews,
    "material unavailable",
    "file_changes.exists(file, file.added)",
  );
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-1",
    readCodexCapabilityFailure: () =>
      Object.assign(new Error("Codex must not be required"), {
        code: "codex_authentication_unavailable",
      }),
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "mcp",
    idempotencyKey: "material-error",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  assert.deepEqual(evaluations.readResult("evaluation-1"), {
    applicability_results: [
      {
        assignment: { scope: "installation_wide" },
        error: {
          code: "applicability_file_changes_unavailable",
          detail:
            "Frozen File Changes are unavailable for Applicability evaluation",
          predicate_id: "predicate-1",
        },
        outcome: "error",
        review_id: review.id,
        review_version_id: review.active_version.id,
        rule: {
          profile: "quality-bar-restricted-cel-v1",
          source: "file_changes.exists(file, file.added)",
        },
      },
    ],
    completed_at: "1970-01-01T00:00:00.100Z",
    criterion_results: [],
    evaluation_id: "evaluation-1",
    file_changes: [],
    findings: [],
    outcome: "error",
    review_runs: [],
  });
});

test("renamed before and after paths persist one matched Applicability Result and queue one Review Run", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
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
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `fact-${++fact}`,
    now: () => fact,
  });
  const rule =
    'file_changes.exists(file, file.renamed && file.paths.exists(path, path.matches(":(glob)src/*name*.js")))';
  createAssignedReview(reviews, "renamed path", rule);
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      file_changes: [
        {
          added: false,
          after_path: "src/renamed.js",
          before_path: "src/name.js",
          deleted: false,
          id: "file-change-1",
          modified: true,
          renamed: true,
        },
      ],
      head_commit: "2".repeat(40),
      matches_path(pathspec, path) {
        return (
          pathspec === ":(glob)src/*name*.js" &&
          ["src/name.js", "src/renamed.js"].includes(path)
        );
      },
    }),
    createId: () => "evaluation-renamed",
    createReviewRunId: () => "review-run-renamed",
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "renamed",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  const result = core.get(
    "SELECT outcome, evidence_json FROM applicability_results",
  );
  assert.equal(result?.outcome, "applicable");
  assert.deepEqual(JSON.parse(result?.evidence_json as string).matches[0], {
    after_path: "src/renamed.js",
    before_path: "src/name.js",
    branch_ids: ["branch-1", "branch-2", "branch-3"],
    file_change_id: "file-change-1",
    predicate_ids: ["predicate-1", "predicate-2", "predicate-3", "predicate-4"],
    sides: ["change", "before", "after"],
  });
  assert.deepEqual(core.get("SELECT id, execution_status FROM review_runs"), {
    execution_status: "queued",
    id: "review-run-renamed",
  });
});
