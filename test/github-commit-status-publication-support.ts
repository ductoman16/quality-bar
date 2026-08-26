export function arrangeGitHubCommitStatus(core: any) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-1', 'https://github.com/operator/repository.git', 1, 1)",
  );
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count,
       created_at, verified_at
     ) VALUES (
       'connection-1', 47, 'quality-bar', 73, 91, 'operator',
       'github-rest:2026-03-10', '{}', '{}', 1, 1, 1
     )`,
  );
  core.run(
    "INSERT INTO github_connection_credentials (connection_id, encrypted_credential, created_at) VALUES ('connection-1', 'encrypted', 1)",
  );
  core.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, api_profile,
       principal_id, principal_login, permissions, capabilities,
       affected_repository_ids, repository_checks, repositories, verified_at
     ) VALUES (
       'verification-1', 'connection-1', 'onboarding', 'success',
       'github-rest:2026-03-10', 91, 'operator', '{}', '{}',
       '[101]', '[{"repository_id":101,"outcome":"success"}]',
       '[{"api_url":"https://api.github.com/repos/operator/repository","clone_url":"https://github.com/operator/repository.git","full_name":"operator/repository","html_url":"https://github.com/operator/repository","id":101,"private":true}]',
       1
     )`,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, verification_id,
       forge_repository_id, name, api_url, web_url
     ) VALUES (
       'repository-1', 'connection-1', 'verification-1', 101,
       'operator/repository',
       'https://api.github.com/repos/operator/repository',
       'https://github.com/operator/repository'
     )`,
  );
  const base = "1".repeat(40);
  const head = "2".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at
     ) VALUES (
       'evaluation-1', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', 2
     )`,
    base,
    head,
    base,
    head,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 2 WHERE id = 'evaluation-1'",
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-1', 'repository-1', 17, ?, ?)`,
    base,
    head,
  );
  return head;
}
