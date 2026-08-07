/**
 * @param {any} core
 * @param {{complete?: boolean, connectionLifecycle?: "enabled" | "retired", impact?: "advisory" | "blocking"}} [options]
 */
export function arrangeForgejoFeedback(
  core,
  {
    complete = true,
    connectionLifecycle = "enabled",
    impact = "blocking",
  } = {},
) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-1', 'https://forgejo.example/operator/repository.git', 1, 1)",
  );
  core.run(
    `INSERT INTO forgejo_connections (
       id, base_url, api_profile, reported_version, principal_id,
       principal_login, scopes, capabilities, health, lifecycle,
       created_at, verified_at
     ) VALUES (
       'connection-1', 'https://forgejo.example', 'forgejo-v16', '16.0.4',
       91, 'operator', '["read:repository"]',
       '{"aggregate_feedback":"verified","commit_status":"verified","inline_feedback":"verified"}',
       'healthy', ?, 1, 1
     )`,
    connectionLifecycle,
  );
  core.run(
    "INSERT INTO forgejo_connection_credentials (connection_id, encrypted_credential, created_at) VALUES ('connection-1', 'encrypted', 1)",
  );
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, profile, reported_version,
       principal, scopes, capabilities, repositories,
       error_code, error_message, verified_at
     ) VALUES (
       'verification-1', 'connection-1', 'onboarding', 'forgejo-v16',
       '16.0.4', '{"id":91,"login":"operator"}', '["read:repository"]',
       '{"aggregate_feedback":"verified","commit_status":"verified","inline_feedback":"verified"}',
       '[{"api_url":"https://forgejo.example/api/v1/repos/operator/repository","clone_url":"https://forgejo.example/operator/repository.git","full_name":"operator/repository","html_url":"https://forgejo.example/operator/repository","id":101,"outcome":"success","permissions":{"admin":true,"pull":true,"push":true},"private":true}]',
       NULL, NULL, 1
     )`,
  );
  core.run(
    `INSERT INTO forgejo_repositories (
       repository_id, connection_id, verification_id,
       forge_repository_id, name, api_url, web_url
     ) VALUES (
       'repository-1', 'connection-1', 'verification-1', 101,
       'operator/repository',
       'https://forgejo.example/api/v1/repos/operator/repository',
       'https://forgejo.example/operator/repository'
     )`,
  );
  core.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      "INSERT INTO reviews (id, name, description, active_version_id, created_at) VALUES ('review-1', 'Review', 'Review description', 'version-1', 1)",
    );
    transaction.run(
      "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, created_at, sealed_at) VALUES ('version-1', 'review-1', 1, 'gpt-5.6-terra', 'high', 'standard', 1, NULL)",
    );
    transaction.run(
      "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES ('criterion-1', 'review-1', 'Find concern', ?, 1)",
      impact,
    );
    transaction.run(
      "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES ('version-1', 'criterion-1', 1, 'Find concern', ?)",
      impact,
    );
    transaction.run(
      "UPDATE review_versions SET sealed_at = 1 WHERE id = 'version-1'",
    );
    transaction.run(
      "INSERT INTO review_assignments (review_id, scope, created_at) VALUES ('review-1', 'installation_wide', 1)",
    );
  });
  const base = "1".repeat(40);
  const head = "2".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status,
       applicability_sealed_at, created_at, completed_at
     ) VALUES (
       'evaluation-1', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, ?, NULL, 2, ?
     )`,
    base,
    head,
    base,
    head,
    complete ? "completed" : "running",
    complete ? 3 : null,
  );
  core.run(
    `INSERT INTO forgejo_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-1', 'repository-1', 17, ?, ?)`,
    base,
    head,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope
     ) VALUES ('evaluation-1', 'review-1', 'version-1', 'installation_wide')`,
  );
  core.run(
    `INSERT INTO applicability_results (
       evaluation_id, review_id, review_version_id, assignment_scope,
       outcome, evidence_json
     ) VALUES (
       'evaluation-1', 'review-1', 'version-1', 'installation_wide',
       'applicable', '{"kind":"unconditional"}')`,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 2 WHERE id = 'evaluation-1'",
  );
  core.run(
    "INSERT INTO review_runs (id, evaluation_id, review_id, review_version_id, execution_status, started_at, completed_at, created_at) VALUES ('run-1', 'evaluation-1', 'review-1', 'version-1', 'running', 2, NULL, 2)",
  );
  core.run(
    "INSERT INTO criterion_results (review_run_id, criterion_id, outcome) VALUES ('run-1', 'criterion-1', 'triggered')",
  );
  core.run(
    `INSERT INTO evaluation_file_changes (
       evaluation_id, id, added, deleted, modified, renamed,
       before_path, after_path, base_line_count, head_line_count, patch
     ) VALUES (
       'evaluation-1', 'change-1', 0, 0, 1, 0,
       'src/example.js', 'src/example.js', 10, 10,
       '@@ -1,2 +1,3 @@\n context\n-old\n+new\n+head\n'
     )`,
  );
  core.run(
    `INSERT INTO findings (
       id, evaluation_id, review_run_id, criterion_id,
       evidence, remediation, location_kind, file_change_id,
       side, start_line, end_line
     ) VALUES
       ('finding-inline', 'evaluation-1', 'run-1', 'criterion-1',
        'Inline evidence', 'Inline remediation', 'line_range', 'change-1',
        'head', 2, 2),
       ('finding-whole', 'evaluation-1', 'run-1', 'criterion-1',
        'Whole-side evidence', 'Whole-side remediation', 'whole_side', 'change-1',
        'base', NULL, NULL),
       ('finding-stale', 'evaluation-1', 'run-1', 'criterion-1',
        'Stale evidence', 'Stale remediation', 'line_range', 'change-1',
        'head', 10, 10)`,
  );
  if (complete) {
    core.run(
      "UPDATE review_runs SET execution_status = 'completed', completed_at = 3 WHERE id = 'run-1'",
    );
    core.run(
      "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-1', 'blocking', 3)",
    );
  }
  return { base, head };
}
