/** @param {any} core @param {{baseCommit?: string, headCommit?: string, repositoryUrl?: string}} [options] */
export function seedCompletedEvaluation(
  core,
  {
    baseCommit = "a".repeat(40),
    headCommit = "b".repeat(40),
    repositoryUrl = "https://example.invalid/repository.git",
  } = {},
) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-1', ?, 1, 1)",
    repositoryUrl,
  );
  core.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      "INSERT INTO reviews (id, name, description, archived_at, active_version_id, hard_delete_pending, created_at) VALUES ('review-1', 'Review', 'Description', NULL, 'version-1', 0, 1)",
    );
    transaction.run(
      "INSERT INTO review_versions (id, review_id, number, applicability_rule, model, reasoning_effort, service_tier, created_at, sealed_at) VALUES ('version-1', 'review-1', 1, NULL, 'gpt-5.6-terra', 'high', 'standard', 1, NULL)",
    );
  });
  for (const [id, impact] of [
    ["criterion-1", "advisory"],
    ["criterion-2", "advisory"],
    ["criterion-blocking", "blocking"],
  ]) {
    core.run(
      "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES (?, 'review-1', ?, ?, 1)",
      id,
      id,
      impact,
    );
    core.run(
      "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES ('version-1', ?, ?, ?, ?)",
      id,
      id === "criterion-1" ? 1 : id === "criterion-2" ? 2 : 3,
      id,
      impact,
    );
  }
  core.run("UPDATE review_versions SET sealed_at = 1 WHERE id = 'version-1'");
  core.run(
    "INSERT INTO evaluations (id, repository_id, provenance, base_selector_type, base_selector_value, head_selector_type, head_selector_value, base_commit, head_commit, execution_status, applicability_sealed_at, next_attempt_at, created_at, completed_at) VALUES ('evaluation-1', 'repository-1', 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'completed', NULL, NULL, 1, 2)",
    baseCommit,
    headCommit,
    baseCommit,
    headCommit,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 1 WHERE id = 'evaluation-1'",
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-1', 'advisory', 2)",
  );
  core.run(
    "INSERT INTO review_runs (id, evaluation_id, review_id, review_version_id, execution_status, started_at, completed_at, execution_evidence_recorded, created_at) VALUES ('run-1', 'evaluation-1', 'review-1', 'version-1', 'running', 1, NULL, 1, 1)",
  );
  for (const criterion of [
    "criterion-1",
    "criterion-2",
    "criterion-blocking",
  ]) {
    core.run(
      "INSERT INTO criterion_results (review_run_id, criterion_id, outcome) VALUES ('run-1', ?, 'triggered')",
      criterion,
    );
  }
  for (const [id, criterion] of [
    ["finding-1", "criterion-1"],
    ["finding-2", "criterion-2"],
    ["finding-blocking", "criterion-blocking"],
  ]) {
    core.run(
      "INSERT INTO findings (id, evaluation_id, review_run_id, criterion_id, evidence, remediation, location_kind) VALUES (?, 'evaluation-1', 'run-1', ?, 'Evidence', 'Remediation', 'changeset')",
      id,
      criterion,
    );
  }
  core.run(
    "UPDATE review_runs SET execution_status = 'completed', completed_at = 2 WHERE id = 'run-1'",
  );
  core.run(
    "INSERT INTO waiver_adjudicator_configuration (singleton, model, reasoning_effort, service_tier, updated_at) VALUES (1, 'gpt-5.6-terra', 'high', 'standard', 1)",
  );
}
