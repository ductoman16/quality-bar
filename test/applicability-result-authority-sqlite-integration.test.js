import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createEvaluationService } from "../src/evaluation/evaluation.js";
import { createReviewService } from "../src/review/review.js";

/** @param {string} name */
function definition(name) {
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

/**
 * @param {ReturnType<typeof createReviewService>} reviews
 * @param {string} name
 * @param {string | null} applicabilityRule
 */
function createAssignedReview(reviews, name, applicabilityRule) {
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

test("Applicability Result authority rejects late, mismatched, malformed, or contradictory records", async (context) => {
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
  const invalidJson = createAssignedReview(reviews, "invalid JSON", null);
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-sealed",
    createReviewRunId: () => "review-run-1",
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 100,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "sealed",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  assert.throws(
    () =>
      core.run(
        "UPDATE evaluations SET applicability_sealed_at = NULL WHERE id = ?",
        "evaluation-sealed",
      ),
    /applicability_result_seal_immutable/,
  );
  for (const table of ["applicability_selections", "applicability_results"]) {
    const isResult = table === "applicability_results";
    assert.throws(
      () =>
        core.run(
          `INSERT INTO ${table} (
             evaluation_id, review_id, review_version_id, assignment_scope,
             profile, rule_source${isResult ? ", outcome, evidence_json" : ""}
           ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL${
             isResult ? ", 'applicable', '{\"kind\":\"unconditional\"}'" : ""
           })`,
          "evaluation-sealed",
          invalidJson.id,
          invalidJson.active_version.id,
        ),
      /applicability_result_insertion_closed/,
    );
  }
  const evaluationInsert = `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at,
       applicability_sealed_at
     ) VALUES (?, ?, 'explicit', 'branch', 'main', 'branch', 'topic', ?, ?, 'queued', ?, ?)`;
  assert.throws(
    () =>
      core.run(
        evaluationInsert,
        "evaluation-presealed",
        "repository-1",
        "1".repeat(40),
        "2".repeat(40),
        200,
        200,
      ),
    /applicability_result_seal_must_transition/,
  );
  core.run(
    evaluationInsert,
    "evaluation-invalid",
    "repository-1",
    "1".repeat(40),
    "2".repeat(40),
    200,
    null,
  );
  const otherReview = createAssignedReview(reviews, "other identity", null);
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_selections (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source
         ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL)`,
        "evaluation-invalid",
        invalidJson.id,
        otherReview.active_version.id,
      ),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_selections (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source
         ) VALUES (?, ?, ?, 'installation_wide', ?, ?)`,
        "evaluation-invalid",
        invalidJson.id,
        invalidJson.active_version.id,
        "quality-bar-restricted-cel-v1",
        "false",
      ),
    /applicability_selection_rule_mismatch/,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source
     ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL)`,
    "evaluation-invalid",
    invalidJson.id,
    invalidJson.active_version.id,
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE evaluations SET applicability_sealed_at = ? WHERE id = ?",
        201,
        "evaluation-invalid",
      ),
    /applicability_result_set_incomplete/,
  );
  for (const evidence of [
    "{",
    '{"kind":"invented"}',
    '{"kind":"matched","repository_contents":"secret"}',
    '{"kind":"unconditional","repository_contents":"secret"}',
  ]) {
    assert.throws(
      () =>
        core.run(
          `INSERT INTO applicability_results (
             evaluation_id, review_id, review_version_id, assignment_scope,
             profile, rule_source, outcome, evidence_json, error_code,
             error_detail, error_context_json
           ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL, 'applicable', ?, NULL, NULL, NULL)`,
          "evaluation-invalid",
          invalidJson.id,
          invalidJson.active_version.id,
          evidence,
        ),
      /applicability_result_evidence_invalid|CHECK constraint failed/,
    );
  }
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_results (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source, outcome, evidence_json, error_code,
           error_detail, error_context_json
         ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL, 'error', NULL, ?, ?, ?)`,
        "evaluation-invalid",
        invalidJson.id,
        invalidJson.active_version.id,
        "applicability_owned_error",
        "Owned failure",
        JSON.stringify({
          code: "applicability_other_error",
          detail: "Owned failure",
        }),
      ),
    /applicability_result_error_invalid|CHECK constraint failed/,
  );
  const invalidError = createAssignedReview(
    reviews,
    "invalid error identity",
    "true",
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source
     ) VALUES (?, ?, ?, 'installation_wide', ?, ?)`,
    "evaluation-invalid",
    invalidError.id,
    invalidError.active_version.id,
    "quality-bar-restricted-cel-v1",
    "true",
  );
  for (const invalidErrorIdentity of [
    { file_change_id: "" },
    { predicate_id: "predicate-0" },
    { predicate_id: "predicate-unbounded" },
  ]) {
    assert.throws(
      () =>
        core.run(
          `INSERT INTO applicability_results (
             evaluation_id, review_id, review_version_id, assignment_scope,
             profile, rule_source, outcome, evidence_json, error_code,
             error_detail, error_context_json
           ) VALUES (?, ?, ?, 'installation_wide', ?, ?, 'error', NULL, ?, ?, ?)`,
          "evaluation-invalid",
          invalidError.id,
          invalidError.active_version.id,
          "quality-bar-restricted-cel-v1",
          "true",
          "applicability_owned_error",
          "Owned failure",
          JSON.stringify({
            code: "applicability_owned_error",
            detail: "Owned failure",
            ...invalidErrorIdentity,
          }),
        ),
      /CHECK constraint failed/,
    );
  }
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_results (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source, outcome, evidence_json, error_code,
           error_detail, error_context_json
         ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL, 'not_applicable', ?, NULL, NULL, NULL)`,
        "evaluation-invalid",
        invalidJson.id,
        invalidJson.active_version.id,
        '{"kind":"unconditional"}',
      ),
    /applicability_result_evidence_invalid/,
  );
  const invalidOutcome = createAssignedReview(
    reviews,
    "invalid outcome evidence",
    "false",
  );
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_selections (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source
         ) VALUES (?, ?, ?, 'installation_wide', NULL, ?)`,
        "evaluation-invalid",
        invalidOutcome.id,
        invalidOutcome.active_version.id,
        "false",
      ),
    /CHECK constraint failed/,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source
     ) VALUES (?, ?, ?, 'installation_wide', ?, ?)`,
    "evaluation-invalid",
    invalidOutcome.id,
    invalidOutcome.active_version.id,
    "quality-bar-restricted-cel-v1",
    "false",
  );
  assert.throws(
    () =>
      core.run(
        `INSERT INTO applicability_results (
           evaluation_id, review_id, review_version_id, assignment_scope,
           profile, rule_source, outcome, evidence_json, error_code,
           error_detail, error_context_json
         ) VALUES (?, ?, ?, 'installation_wide', NULL, ?, 'not_applicable', ?, NULL, NULL, NULL)`,
        "evaluation-invalid",
        invalidOutcome.id,
        invalidOutcome.active_version.id,
        "false",
        JSON.stringify({
          branch_ids: [],
          kind: "failed_branches",
          predicate_ids: [],
        }),
      ),
    /CHECK constraint failed|FOREIGN KEY constraint failed/,
  );
  /** @type {Array<[string, Record<string, unknown>]>} */
  const contradictoryResults = [
    [
      "applicable",
      { branch_ids: [], kind: "failed_branches", predicate_ids: [] },
    ],
    [
      "not_applicable",
      {
        branch_ids: [],
        kind: "satisfied_branches",
        predicate_ids: ["predicate-1"],
      },
    ],
    [
      "not_applicable",
      {
        kind: "matched",
        matches: [
          {
            after_path: "src/file.js",
            before_path: null,
            branch_ids: ["branch-1"],
            file_change_id: "file-change-1",
            predicate_ids: ["predicate-1"],
            sides: ["change"],
          },
        ],
      },
    ],
  ];
  for (const [outcome, evidence] of contradictoryResults) {
    assert.throws(
      () =>
        core.run(
          `INSERT INTO applicability_results (
             evaluation_id, review_id, review_version_id, assignment_scope,
             profile, rule_source, outcome, evidence_json, error_code,
             error_detail, error_context_json
           ) VALUES (?, ?, ?, 'installation_wide', ?, ?, ?, ?, NULL, NULL, NULL)`,
          "evaluation-invalid",
          invalidOutcome.id,
          invalidOutcome.active_version.id,
          "quality-bar-restricted-cel-v1",
          "false",
          outcome,
          JSON.stringify(evidence),
        ),
      /applicability_result_evidence_invalid/,
    );
  }
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM applicability_results
       WHERE evaluation_id = 'evaluation-invalid' AND review_id = ?`,
      invalidJson.id,
    )?.count,
    0,
  );
});
