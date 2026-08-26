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
  applicabilityRule: string,
) {
  const created = reviews.create(definition(name));
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

test("text selects one Review Run while binary negation and unreadable content persist honest terminal Results", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-content-"));
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
  const textReview = createAssignedReview(
    reviews,
    "text",
    'file_changes.exists(file, file.after_path.matches(":(glob)text.txt") && file.after_content.matches("complete marker"))',
  );
  createAssignedReview(
    reviews,
    "binary",
    'file_changes.exists(file, file.after_path.matches(":(glob)binary.bin") && !file.after_content.matches("anything"))',
  );
  createAssignedReview(
    reviews,
    "unreadable",
    'file_changes.exists(file, file.after_path.matches(":(glob)unreadable.txt") && file.after_content.matches("anything"))',
  );
  const added = {
    added: true,
    before_content: { state: "absent" },
    before_path: null,
    deleted: false,
    modified: false,
    renamed: false,
  };
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      file_changes: [
        {
          ...added,
          after_content: { state: "text", value: "complete marker" },
          after_path: "text.txt",
          id: "file-change-1",
        },
        {
          ...added,
          after_content: { state: "binary" },
          after_path: "binary.bin",
          id: "file-change-2",
        },
        {
          ...added,
          after_content: {
            error: {
              code: "applicability_file_side_unreadable",
              detail: "The frozen after side could not be read.",
            },
            state: "error",
          },
          after_path: "unreadable.txt",
          id: "file-change-3",
        },
      ],
      head_commit: "2".repeat(40),
      matches_path(pathspec, path) {
        return pathspec === `:(glob)${path}`;
      },
    }),
    createId: () => "evaluation-content",
    createReviewRunId: () => "review-run-content",
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "content",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });

  assert.deepEqual(
    core
      .all(
        `SELECT outcome, error_code, error_detail, error_context_json
         FROM applicability_results ORDER BY review_id`,
      )
      .map((result) => {
        assert.ok(result);
        return {
          error_code: result.error_code,
          error_detail: result.error_detail,
          error_context:
            result.error_context_json === null
              ? null
              : JSON.parse(result.error_context_json as string),
          outcome: result.outcome,
        };
      }),
    [
      {
        error_code: null,
        error_context: null,
        error_detail: null,
        outcome: "applicable",
      },
      {
        error_code: null,
        error_context: null,
        error_detail: null,
        outcome: "not_applicable",
      },
      {
        error_code: "applicability_file_side_unreadable",
        error_context: {
          code: "applicability_file_side_unreadable",
          detail: "The frozen after side could not be read.",
          file_change_id: "file-change-3",
          predicate_id: "predicate-3",
          side: "after",
        },
        error_detail: "The frozen after side could not be read.",
        outcome: "error",
      },
    ],
  );
  assert.deepEqual(core.get("SELECT id, review_id FROM review_runs"), {
    id: "review-run-content",
    review_id: textReview.id,
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM codex_execution_queue")?.count,
    1,
  );
});

test("a malformed acquired content reader fails before durable Evaluation work", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-content-reader-"));
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
  createAssignedReview(reviews, "irrelevant reader", "true");
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
      read_content: "invalid" as any,
    }),
    createId: () => "evaluation-invalid-reader",
    createReviewRunId: () => "review-run-invalid-reader",
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await assert.rejects(
    () =>
      evaluations.createExplicit({
        channel: "implementer_token",
        idempotencyKey: "invalid-reader",
        repositoryId: "repository-1",
        request: {
          base: { type: "branch", value: "main" },
          head: { type: "branch", value: "topic" },
        },
      }),
    (error) =>
      error instanceof TypeError &&
      error.message === "Frozen Changeset content reader is invalid",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 0);
});
