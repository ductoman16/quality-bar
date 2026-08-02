import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/** @param {any} core */
function attachGitHubPublication(core) {
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count, lifecycle,
       created_at, verified_at
     ) VALUES (
       'connection-1', 47, 'quality-bar', 73, 91, 'operator',
       'github-rest:2026-03-10', '{}', '{}', 1, 'enabled', 1, 1
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
       '[{"api_url":"https://api.github.com/repos/operator/repository","clone_url":"https://github.com/operator/repository.git","full_name":"operator/repository","html_url":"https://github.com/operator/repository","id":101,"private":true}]', 1
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
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) SELECT id, repository_id, 17, base_commit, head_commit
       FROM evaluations WHERE id = 'evaluation-1'`,
  );
  core.run(
    "INSERT INTO github_commit_statuses (repository_id, head_commit, evaluation_id, desired_state, publication_status) SELECT repository_id, head_commit, id, 'failure', 'waiting' FROM evaluations WHERE id = 'evaluation-1'",
  );
  core.run(
    "INSERT INTO github_feedback_bundles (evaluation_id, publication_status, external_id, published_at) VALUES ('evaluation-1', 'succeeded', 701, 3)",
  );
  core.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, external_id, published_at
     ) VALUES
       ('finding-1', 'evaluation-1', 'succeeded',
        'src/example.js', 'RIGHT', 7, 801, 3),
       ('finding-2', 'evaluation-1', 'aggregate_only',
        NULL, NULL, NULL, NULL, NULL)`,
  );
}

test("waiver status transitions preserve GitHub retirement failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-retired-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core, {
      repositoryUrl: "https://github.com/operator/repository.git",
    });
    attachGitHubPublication(core);

    /** @param {string} adjudicationId @param {string} requestId @param {string} findingId @param {number} timestamp */
    function submit(adjudicationId, requestId, findingId, timestamp) {
      createWaiverBatchService(core, {
        createAdjudicationId: () => adjudicationId,
        createRequestId: () => requestId,
        now: () => timestamp,
        readCodexCapabilityFailure: () => null,
        storageReserve: { assertWorkAdmissionAvailable() {} },
      }).submit({
        channel: "browser_session",
        evaluationId: "evaluation-1",
        idempotencyKey: adjudicationId,
        request: {
          requests: [{ finding_id: findingId, rationale: "Exact exception." }],
        },
      });
      core.run(
        `UPDATE codex_execution_queue
         SET worker_id = ?, fencing_token = 1,
             lease_expires_at = ?, started_at = ?
         WHERE work_id = ?`,
        `worker-${adjudicationId}`,
        timestamp + 100,
        timestamp + 1,
        adjudicationId,
      );
    }

    /** @param {string} adjudicationId @param {number} timestamp */
    function start(adjudicationId, timestamp) {
      core.run(
        `UPDATE waiver_adjudications
         SET execution_status = 'running', started_at = ?,
             codex_cli_version = '0.114.0'
         WHERE id = ?`,
        timestamp,
        adjudicationId,
      );
    }

    /** @param {string} adjudicationId @param {string} requestId @param {string} decisionId @param {number} timestamp */
    function finish(adjudicationId, requestId, decisionId, timestamp) {
      createWaiverAdjudicationResultService(core, {
        createDecisionId: () => decisionId,
        now: () => timestamp,
      }).prepare(
        {
          fencingToken: 1,
          workerId: `worker-${adjudicationId}`,
          workId: adjudicationId,
        },
        {
          decisions: [
            {
              explanation: "The exception is justified.",
              outcome: "accepted",
              request_id: requestId,
            },
          ],
        },
      );
    }

    const retiredStatus = {
      error_code: "github_connection_retired",
      publication_status: "unavailable",
    };
    submit(
      "adjudication-retired-start",
      "request-retired-start",
      "finding-1",
      30,
    );
    core.run(
      `UPDATE github_commit_statuses
       SET publication_status = 'unavailable', error_code = 'github_connection_retired',
           error_detail = 'GitHub commit status publication is unavailable because the GitHub Connection is retired'`,
    );
    start("adjudication-retired-start", 31);
    assert.deepEqual(
      core.get(
        "SELECT publication_status, error_code FROM github_commit_statuses",
      ),
      retiredStatus,
    );
    finish(
      "adjudication-retired-start",
      "request-retired-start",
      "decision-retired-start",
      32,
    );
    assert.deepEqual(
      core.get(
        "SELECT publication_status, error_code FROM github_commit_statuses",
      ),
      retiredStatus,
    );

    core.run(
      `UPDATE github_commit_statuses
       SET desired_state = 'failure', publication_status = 'succeeded',
           published_state = 'failure', published_at = 33,
           error_code = NULL, error_detail = NULL`,
    );
    submit(
      "adjudication-retired-finish",
      "request-retired-finish",
      "finding-2",
      34,
    );
    start("adjudication-retired-finish", 35);
    assert.equal(
      core.get("SELECT publication_status FROM github_commit_statuses")
        ?.publication_status,
      "waiting",
    );
    core.run(
      `UPDATE github_commit_statuses
       SET publication_status = 'unavailable', error_code = 'github_connection_retired',
           error_detail = 'GitHub commit status publication is unavailable because the GitHub Connection is retired'`,
    );
    finish(
      "adjudication-retired-finish",
      "request-retired-finish",
      "decision-retired-finish",
      36,
    );
    assert.deepEqual(
      core.get(
        "SELECT publication_status, error_code FROM github_commit_statuses",
      ),
      retiredStatus,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
