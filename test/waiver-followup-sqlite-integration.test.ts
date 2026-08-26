import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createGitHubCommitStatusService } from "../src/github/github-commit-status-service.ts";
import { GitHubConnectionError } from "../src/github/github-connection-error.ts";
import { createGitHubWaiverFollowupService } from "../src/github/github-waiver-followup-service.ts";
import { readEvaluationWaiverAdjudications } from "../src/waiver/waiver-adjudication-resource.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function attachGitHubPublication(core: any) {
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

test("SQLite admits and GitHub publishes aggregate plus accepted original-inline follow-ups", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-followup-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core, {
      repositoryUrl: "https://github.com/operator/repository.git",
    });
    attachGitHubPublication(core);
    const requestIds = ["request-1", "request-2"];
    createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-1",
      createRequestId: () => requestIds.shift() ?? assert.fail("missing id"),
      now: () => 10,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).submit({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "waiver-key",
      request: {
        requests: [
          { finding_id: "finding-1", rationale: "Exact exception." },
          { finding_id: "finding-2", rationale: "Second exception." },
        ],
      },
    });
    core.run(
      `UPDATE codex_execution_queue
       SET worker_id = 'worker-1', fencing_token = 1,
           lease_expires_at = 100, started_at = 11
       WHERE work_id = 'adjudication-1'`,
    );
    core.run(
      `UPDATE waiver_adjudications
       SET execution_status = 'running', started_at = 11,
           codex_cli_version = '0.114.0'
       WHERE id = 'adjudication-1'`,
    );
    assert.equal(
      core.get("SELECT desired_state FROM github_commit_statuses")
        ?.desired_state,
      "pending",
    );
    const statusWrites: string[] = [];
    const statusService = createGitHubCommitStatusService(core, {
      cipher: {
        decrypt() {
          return { client_id: "client", pem: "private-key" };
        },
      },
      externalOrigin: "https://quality-bar.example",
      ioPool: {
        run: (duty: any, operation: any) => {
          void duty;
          return operation();
        },
      },
      now: () => 11,
      verifier: {
        async publishCommitStatus(
          authentication,
          installationId,
          repository,
          status,
        ) {
          void authentication;
          void installationId;
          void repository;
          statusWrites.push(status.state);
          return 1;
        },
        async reconcileCommitStatus() {
          assert.fail("successful status must not reconcile");
        },
      },
    });
    await statusService.publishWaiting();

    const decisions = ["decision-accepted", "decision-denied"];
    createWaiverAdjudicationResultService(core, {
      createDecisionId: () => decisions.shift() ?? assert.fail("missing id"),
      now: () => 12,
    }).prepare(
      { fencingToken: 1, workerId: "worker-1", workId: "adjudication-1" },
      {
        decisions: [
          {
            explanation: "The exact exception is justified.",
            outcome: "accepted",
            request_id: "request-1",
          },
          {
            explanation: "The second exception is not justified.",
            outcome: "denied",
            request_id: "request-2",
          },
        ],
      },
    );

    assert.deepEqual(
      core.all(
        "SELECT waiver_adjudication_id, outcome, publication_status FROM github_waiver_adjudication_followups",
      ),
      [
        {
          publication_status: "waiting",
          outcome: "blocking",
          waiver_adjudication_id: "adjudication-1",
        },
      ],
    );
    assert.deepEqual(
      core.all(
        "SELECT waiver_decision_id, finding_id, original_external_id FROM github_waiver_decision_followups",
      ),
      [
        {
          finding_id: "finding-1",
          original_external_id: 801,
          waiver_decision_id: "decision-accepted",
        },
      ],
    );
    assert.equal(
      core.get("SELECT desired_state FROM github_commit_statuses")
        ?.desired_state,
      "failure",
    );
    await statusService.publishWaiting();
    statusService.destroy();
    assert.deepEqual(statusWrites, ["pending", "failure"]);
    createWaiverBatchService(core, {
      createAdjudicationId: () => "adjudication-2",
      createRequestId: () => "request-3",
      now: () => 13,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).submit({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: "later-waiver-key",
      request: {
        requests: [
          {
            finding_id: "finding-2",
            rationale: "Revised second exception.",
          },
        ],
      },
    });
    core.run(
      `UPDATE codex_execution_queue
       SET worker_id = 'worker-2', fencing_token = 1,
           lease_expires_at = 100, started_at = 14
       WHERE work_id = 'adjudication-2'`,
    );
    core.run(
      `UPDATE waiver_adjudications
       SET execution_status = 'running', started_at = 14,
           codex_cli_version = '0.114.0'
       WHERE id = 'adjudication-2'`,
    );
    const writes: any[] = [];
    let aggregateAttempts = 0;
    let publicationTime = 20;
    const service = createGitHubWaiverFollowupService(core, {
      cipher: {
        decrypt() {
          return { client_id: "client", pem: "private-key" };
        },
      },
      externalOrigin: "https://quality-bar.example",
      ioPool: {
        run: (duty: any, operation: any) => {
          void duty;
          return operation();
        },
      },
      now: () => publicationTime,
      verifier: {
        async publishAggregateFeedback(...parameters: Array<any>) {
          writes.push({ kind: "aggregate", parameters });
          aggregateAttempts += 1;
          if (aggregateAttempts === 1) {
            throw new GitHubConnectionError(
              "github_api_transient_failure",
              "GitHub API request temporarily failed with HTTP 429",
              { nextAttemptAt: 60_000, responseStatus: 429 },
            );
          }
          return 901;
        },
        async publishReviewCommentReply(...parameters: Array<any>) {
          writes.push({ kind: "reply", parameters });
          return 902;
        },
        async reconcileAggregateFeedback() {
          return null;
        },
        async reconcileReviewCommentReply() {
          assert.fail("successful reply must not reconcile");
        },
      },
    });
    await service.publishWaiting();
    assert.deepEqual(
      readEvaluationWaiverAdjudications(core, "evaluation-1")[0]?.followup
        .aggregate,
      {
        error: {
          code: "github_api_transient_failure",
          detail: "GitHub API request temporarily failed with HTTP 429",
        },
        latest_attempt: {
          attempt_count: 1,
          error: {
            code: "github_api_transient_failure",
            detail: "GitHub API request temporarily failed with HTTP 429",
          },
          last_attempt_at: "1970-01-01T00:00:00.020Z",
          next_attempt_at: "1970-01-01T00:01:00.020Z",
          reconciliation_required: true,
        },
        publication_status: "waiting",
      },
    );
    publicationTime = 60_020;
    await service.publishWaiting();
    service.destroy();
    assert.deepEqual(
      writes.map(({ kind, parameters }) => ({
        kind,
        originalCommentId: kind === "reply" ? parameters[4] : null,
      })),
      [
        { kind: "aggregate", originalCommentId: null },
        { kind: "aggregate", originalCommentId: null },
        { kind: "reply", originalCommentId: 801 },
      ],
    );
    assert.match(writes[1].parameters.at(-1), /Recomputed outcome: blocking/);
    assert.deepEqual(
      core.get(
        "SELECT publication_status, external_id FROM github_waiver_adjudication_followups",
      ),
      { external_id: 901, publication_status: "succeeded" },
    );
    assert.deepEqual(
      core.get(
        "SELECT publication_status, external_id FROM github_waiver_decision_followups",
      ),
      { external_id: 902, publication_status: "succeeded" },
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
