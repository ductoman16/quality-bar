import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  createGitHubCommitStatusService,
  readStatusTarget,
} from "../src/github-commit-status-service.js";
import { resumeGitHubDeliveries } from "../src/github-delivery-recovery.js";
import {
  EVALUATION_SELECTION,
  readEvaluation,
} from "../src/evaluation-resource.js";
import {
  readAggregateDeliveryTarget,
  readInlineDeliveryTarget,
} from "../src/github-feedback-delivery-target.js";
import { arrangeGitHubFeedback as arrange } from "./github-feedback-publication-support.js";

test("schema 40 preserves successful identities and reconciles uncertain delivery history", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-v40-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  arrange(prior);
  prior.run(
    `UPDATE github_commit_statuses
     SET publication_status = 'unavailable',
         error_code = 'github_api_request_failed',
         error_detail = 'GitHub API request failed with HTTP 403'`,
  );
  prior.run(
    `UPDATE github_feedback_bundles
     SET publication_status = 'succeeded',
         external_id = 701,
         published_at = 11`,
  );
  prior.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, error_code, error_detail
     ) VALUES (
       'finding-inline', 'evaluation-1', 'unavailable',
       'src/example.js', 'RIGHT', 1,
       'github_api_unavailable',
       'GitHub API request could not complete'
     )`,
  );
  prior.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, line, error_code, error_detail
     ) VALUES (
       'finding-stale', 'evaluation-1', 'unavailable',
       'src/example.js', 'RIGHT', 10,
       'github_connection_retired',
       'GitHub feedback publication is unavailable because the GitHub Connection is retired'
     )`,
  );
  prior.transaction((transaction) => {
    for (const trigger of [
      "github_commit_status_delivery_admit",
      "github_commit_status_delivery_update_admit",
      "github_feedback_bundle_delivery_admit",
      "github_finding_feedback_delivery_admit",
    ]) {
      transaction.run(`DROP TRIGGER ${trigger}`);
    }
    transaction.run("DROP TABLE github_delivery_provider_gates");
    transaction.run("DROP TABLE github_delivery_attempts");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '40' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 40");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 44);
  assert.deepEqual(
    migrated.all(
      `SELECT surface, source_id, connection_id, authority_verified_at,
              attempt_count, last_attempt_at,
              reconciliation_required, external_id, error_code,
              response_status, definitive
       FROM github_delivery_attempts
       ORDER BY surface, source_id`,
    ),
    [
      {
        attempt_count: 1,
        authority_verified_at: 1,
        connection_id: "connection-1",
        definitive: 0,
        error_code: null,
        external_id: 701,
        last_attempt_at: 11,
        reconciliation_required: 0,
        response_status: null,
        source_id: "evaluation-1",
        surface: "aggregate_feedback",
      },
      {
        attempt_count: 1,
        authority_verified_at: 1,
        connection_id: "connection-1",
        definitive: 1,
        error_code: "github_api_request_failed",
        external_id: null,
        last_attempt_at: null,
        reconciliation_required: 1,
        response_status: 403,
        source_id: "evaluation-1:failure",
        surface: "commit_status",
      },
      {
        attempt_count: 1,
        authority_verified_at: 1,
        connection_id: "connection-1",
        definitive: 0,
        error_code: "github_api_unavailable",
        external_id: null,
        last_attempt_at: null,
        reconciliation_required: 1,
        response_status: null,
        source_id: "finding-inline",
        surface: "inline_feedback",
      },
      {
        attempt_count: 0,
        authority_verified_at: null,
        connection_id: null,
        definitive: 1,
        error_code: "github_connection_retired",
        external_id: null,
        last_attempt_at: null,
        reconciliation_required: 0,
        response_status: null,
        source_id: "finding-stale",
        surface: "inline_feedback",
      },
    ],
  );
  assert.equal(
    JSON.parse(
      /** @type {string} */ (
        migrated.get(
          `SELECT target FROM github_delivery_attempts
           WHERE surface = 'commit_status'`,
        )?.target
      ),
    ).repository_id,
    101,
  );
  assert.deepEqual(
    migrated.get(
      `SELECT publication_status, error_code, error_detail
       FROM github_finding_feedback
       WHERE finding_id = 'finding-inline'`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "waiting",
    },
  );
  const migratedResource = readEvaluation(
    migrated.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      "evaluation-1",
    ),
  );
  assert.equal(
    migratedResource.feedback?.findings.find(
      (finding) => finding.finding_id === "finding-stale",
    )?.connection_identity,
    "connection-1",
  );
  migrated.transaction((transaction) => {
    resumeGitHubDeliveries(transaction, "connection-1", 20);
  });
  assert.deepEqual(
    migrated.get(
      `SELECT publication_status, error_code, error_detail
       FROM github_commit_statuses`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "waiting",
    },
  );
  assert.deepEqual(
    migrated.get(
      `SELECT definitive, response_status, next_attempt_at
       FROM github_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    {
      definitive: 0,
      next_attempt_at: 20,
      response_status: null,
    },
  );
  let reconciliations = 0;
  const service = createGitHubCommitStatusService(migrated, {
    cipher: {
      decrypt: () => ({ client_id: "Iv1.client", pem: "private-key" }),
    },
    externalOrigin: "https://quality-bar.example",
    now: () => 20,
    verifier: {
      async publishCommitStatus() {
        return 902;
      },
      async reconcileCommitStatus() {
        reconciliations += 1;
        return 901;
      },
    },
  });
  await service.publishWaiting();
  assert.equal(reconciliations, 1);
});

test("delivery target readers accept exact legacy identities and reject corrupt targets", () => {
  const head = "a".repeat(40);
  const status = {
    description: "Active",
    head,
    state: "pending",
    targetUrl:
      "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
  };
  assert.equal(
    readStatusTarget(
      JSON.stringify({
        context: "Quality Bar",
        head_commit: head,
        repository_id: 101,
        state: "pending",
      }),
      status,
      101,
    ),
    status,
  );
  const aggregate = {
    body: "aggregate\nEvaluation: `evaluation-1`",
    pull_request_number: 17,
    repository_id: 101,
  };
  assert.deepEqual(
    readAggregateDeliveryTarget(
      '{"pull_request_number":17,"repository_id":101}',
      aggregate,
      101,
    ),
    {
      body: "aggregate\nEvaluation: `evaluation-1`",
      pullRequestNumber: 17,
    },
  );
  const inline = {
    body: "inline\nFinding: `finding-1`\nEvaluation: `evaluation-1`",
    commit_id: head,
    line: 2,
    path: "src/example.js",
    pull_request_number: 17,
    repository_id: 101,
    side: "RIGHT",
  };
  assert.deepEqual(
    readInlineDeliveryTarget(
      '{"line":2,"path":"src/example.js","pull_request_number":17,"repository_id":101,"side":"RIGHT","start_line":null,"start_side":null}',
      inline,
      101,
    ),
    {
      comment: {
        body: "inline\nFinding: `finding-1`\nEvaluation: `evaluation-1`",
        commit_id: head,
        line: 2,
        path: "src/example.js",
        side: "RIGHT",
      },
      pullRequestNumber: 17,
    },
  );
  for (const read of [
    () => readStatusTarget("{}", status, 101),
    () =>
      readStatusTarget(
        JSON.stringify({
          context: "Quality Bar",
          description: "Active",
          head,
          repository_id: 101,
          state: "pending",
          target_url:
            "https://old.example/?view=evaluations&evaluation_id=evaluation-other",
        }),
        status,
        101,
      ),
    () => readAggregateDeliveryTarget("{}", aggregate, 101),
    () =>
      readAggregateDeliveryTarget(
        '{"body":"aggregate\\nEvaluation: `evaluation-other`","pull_request_number":17,"repository_id":101}',
        aggregate,
        101,
      ),
    () => readInlineDeliveryTarget("{}", inline, 101),
    () =>
      readInlineDeliveryTarget(
        JSON.stringify({
          ...inline,
          body: "inline\nFinding: `finding-other`\nEvaluation: `evaluation-1`",
        }),
        inline,
        101,
      ),
  ]) {
    assert.throws(read, /delivery target is invalid/);
  }
});
