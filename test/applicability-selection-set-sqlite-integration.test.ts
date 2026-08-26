import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
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

test("Applicability sealing rejects omitted or scope-mismatched assigned Reviews", (context) => {
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
  const assigned = reviews.create(definition("assigned"));
  const evaluationInsert = `INSERT INTO evaluations (
     id, repository_id, provenance,
     base_selector_type, base_selector_value,
     head_selector_type, head_selector_value,
     base_commit, head_commit, execution_status, created_at
   ) VALUES (?, ?, 'explicit', 'branch', 'main', 'branch', 'topic', ?, ?, 'queued', ?)`;
  core.run(
    evaluationInsert,
    "evaluation-wrong-scope",
    "repository-1",
    "1".repeat(40),
    "2".repeat(40),
    100,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source
     ) VALUES (?, ?, ?, 'repository_specific', NULL, NULL)`,
    "evaluation-wrong-scope",
    assigned.id,
    assigned.active_version.id,
  );
  core.run(
    `INSERT INTO applicability_results (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source, outcome, evidence_json
     ) VALUES (?, ?, ?, 'repository_specific', NULL, NULL, 'applicable', ?)`,
    "evaluation-wrong-scope",
    assigned.id,
    assigned.active_version.id,
    '{"kind":"unconditional"}',
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE evaluations SET applicability_sealed_at = ? WHERE id = ?",
        101,
        "evaluation-wrong-scope",
      ),
    /applicability_result_set_incomplete/,
  );

  reviews.create(definition("omitted"));
  core.run(
    evaluationInsert,
    "evaluation-omitted",
    "repository-1",
    "1".repeat(40),
    "2".repeat(40),
    200,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source
     ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL)`,
    "evaluation-omitted",
    assigned.id,
    assigned.active_version.id,
  );
  core.run(
    `INSERT INTO applicability_results (
       evaluation_id, review_id, review_version_id, assignment_scope,
       profile, rule_source, outcome, evidence_json
     ) VALUES (?, ?, ?, 'installation_wide', NULL, NULL, 'applicable', ?)`,
    "evaluation-omitted",
    assigned.id,
    assigned.active_version.id,
    '{"kind":"unconditional"}',
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE evaluations SET applicability_sealed_at = ? WHERE id = ?",
        201,
        "evaluation-omitted",
      ),
    /applicability_result_set_incomplete/,
  );
});
