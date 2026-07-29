import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubFeedbackService } from "../src/github-feedback-service.js";
import {
  EVALUATION_SELECTION,
  readEvaluation,
} from "../src/evaluation-resource.js";

/** @param {ReturnType<typeof openDurableCore>} core */
function arrange(core) {
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
  core.transaction((transaction) => {
    transaction.run(
      "INSERT INTO reviews (id, name, description, active_version_id, created_at) VALUES ('review-1', 'Review', 'Review description', 'version-1', 1)",
    );
    transaction.run(
      "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, created_at, sealed_at) VALUES ('version-1', 'review-1', 1, 'gpt-5.6-terra', 'high', 'standard', 1, NULL)",
    );
    transaction.run(
      "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES ('criterion-1', 'review-1', 'Find concern', 'blocking', 1)",
    );
    transaction.run(
      "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES ('version-1', 'criterion-1', 1, 'Find concern', 'blocking')",
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
       'commit', ?, 'commit', ?, ?, ?, 'completed', NULL, 2, 3
     )`,
    base,
    head,
    base,
    head,
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-1', 'repository-1', 17, ?, ?)`,
    base,
    head,
  );
  core.run(
    `INSERT INTO applicability_selections (
       evaluation_id, review_id, review_version_id, assignment_scope
     ) VALUES (
       'evaluation-1', 'review-1', 'version-1', 'installation_wide'
     )`,
  );
  core.run(
    `INSERT INTO applicability_results (
       evaluation_id, review_id, review_version_id, assignment_scope,
       outcome, evidence_json
     ) VALUES (
       'evaluation-1', 'review-1', 'version-1', 'installation_wide',
       'applicable', '{"kind":"unconditional"}'
     )`,
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
        'base', 1, 2),
       ('finding-whole', 'evaluation-1', 'run-1', 'criterion-1',
        'Whole-side evidence', 'Whole-side remediation', 'whole_side', 'change-1',
        'base', NULL, NULL),
       ('finding-stale', 'evaluation-1', 'run-1', 'criterion-1',
        'Stale evidence', 'Stale remediation', 'line_range', 'change-1',
        'head', 10, 10)`,
  );
  core.run(
    "UPDATE review_runs SET execution_status = 'completed', completed_at = 3 WHERE id = 'run-1'",
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-1', 'blocking', 3)",
  );
  return { base, head };
}

test("one append-only aggregate includes every Finding while only frozen-diff coordinates publish inline", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const { base, head } = arrange(core);
  /** @type {any[][]} */
  const aggregates = [];
  /** @type {any[][]} */
  const inlines = [];
  const service = createGitHubFeedbackService(core, {
    cipher: {
      decrypt() {
        return { client_id: "Iv1.client", pem: "private-key" };
      },
    },
    externalOrigin: "https://quality-bar.example",
    now: () => 10,
    verifier: {
      async publishAggregateFeedback(...parameters) {
        aggregates.push(parameters);
        return 701;
      },
      async publishInlineFeedback(...parameters) {
        inlines.push(parameters);
        return 702;
      },
    },
  });

  await service.publishWaiting();

  assert.equal(aggregates.length, 1);
  assert.match(aggregates[0][4], /Outcome: blocking/);
  assert.match(aggregates[0][4], /finding-inline/);
  assert.match(aggregates[0][4], /finding-whole/);
  assert.match(aggregates[0][4], /finding-stale/);
  assert.match(aggregates[0][4], new RegExp(base));
  assert.match(aggregates[0][4], new RegExp(head));
  assert.equal(inlines.length, 1);
  assert.deepEqual(inlines[0].slice(1, 4), [
    73,
    { full_name: "operator/repository", id: 101 },
    17,
  ]);
  assert.deepEqual(
    {
      commit_id: inlines[0][4].commit_id,
      line: inlines[0][4].line,
      path: inlines[0][4].path,
      side: inlines[0][4].side,
      start_line: inlines[0][4].start_line,
      start_side: inlines[0][4].start_side,
    },
    {
      commit_id: head,
      line: 2,
      path: "src/example.js",
      side: "LEFT",
      start_line: 1,
      start_side: "RIGHT",
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT finding_id, publication_status, external_id
       FROM github_finding_feedback
       ORDER BY finding_id`,
    ),
    [
      {
        external_id: 702,
        finding_id: "finding-inline",
        publication_status: "succeeded",
      },
      {
        external_id: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
      },
      {
        external_id: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
      },
    ],
  );
  const resource = readEvaluation(
    core.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      "evaluation-1",
    ),
  );
  assert.deepEqual(resource.feedback, {
    aggregate: {
      error: null,
      external_id: 701,
      publication_status: "succeeded",
      published_at: "1970-01-01T00:00:00.010Z",
    },
    findings: [
      {
        error: null,
        external_id: 702,
        finding_id: "finding-inline",
        publication_status: "succeeded",
        published_at: "1970-01-01T00:00:00.010Z",
      },
      {
        error: null,
        external_id: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
        published_at: null,
      },
      {
        error: null,
        external_id: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
        published_at: null,
      },
    ],
  });

  const laterHead = "3".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at, completed_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'completed', 4, 5
     )`,
    head,
    laterHead,
    head,
    laterHead,
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-2', 'repository-1', 17, ?, ?)`,
    head,
    laterHead,
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-2', 'clear', 5)",
  );
  assert.deepEqual(
    core.all(
      "SELECT evaluation_id, publication_status, external_id FROM github_feedback_bundles ORDER BY evaluation_id",
    ),
    [
      {
        evaluation_id: "evaluation-1",
        external_id: 701,
        publication_status: "succeeded",
      },
      {
        evaluation_id: "evaluation-2",
        external_id: null,
        publication_status: "waiting",
      },
    ],
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM github_feedback_bundles WHERE evaluation_id = 'evaluation-1'",
      ),
    /github_feedback_bundle_immutable/,
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM github_finding_feedback WHERE finding_id = 'finding-inline'",
      ),
    /github_finding_feedback_immutable/,
  );
});

test("feedback failures preserve exact owning errors without inferred success", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  const failure = new GitHubConnectionError(
    "github_api_request_failed",
    "GitHub API request failed with HTTP 403",
  );
  const service = createGitHubFeedbackService(core, {
    cipher: { decrypt: () => ({}) },
    externalOrigin: "https://quality-bar.example",
    verifier: {
      async publishAggregateFeedback() {
        throw failure;
      },
      async publishInlineFeedback() {
        throw failure;
      },
    },
  });

  await service.publishWaiting();

  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id, error_code, error_detail FROM github_feedback_bundles",
    ),
    {
      error_code: "github_api_request_failed",
      error_detail: "GitHub API request failed with HTTP 403",
      external_id: null,
      publication_status: "unavailable",
    },
  );
  assert.deepEqual(
    core.get(
      "SELECT publication_status, external_id, error_code, error_detail FROM github_finding_feedback WHERE finding_id = 'finding-inline'",
    ),
    {
      error_code: "github_api_request_failed",
      error_detail: "GitHub API request failed with HTTP 403",
      external_id: null,
      publication_status: "unavailable",
    },
  );
});
