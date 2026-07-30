import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { resumeGitHubDeliveries } from "../src/github-delivery-recovery.js";
import { attemptGitHubDelivery } from "../src/github-delivery-service.js";
import {
  githubDeliveryFailure,
  nextGitHubDeliveryAttemptAt,
} from "../src/github-delivery.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";

test("GitHub delivery retries transient failures indefinitely with exponential delay capped at one hour", () => {
  const attemptedAt = 10_000;
  assert.equal(
    nextGitHubDeliveryAttemptAt(attemptedAt, 1, {
      code: "github_api_unavailable",
    }),
    70_000,
  );
  assert.equal(
    nextGitHubDeliveryAttemptAt(attemptedAt, 20, {
      code: "github_api_unavailable",
    }),
    3_610_000,
  );
  assert.equal(
    nextGitHubDeliveryAttemptAt(attemptedAt, 1, {
      code: "github_api_transient_failure",
      nextAttemptAt: 7_210_000,
    }),
    3_610_000,
  );
});

test("GitHub delivery distinguishes definitive failures and uncertain creates", () => {
  assert.deepEqual(
    githubDeliveryFailure(
      new GitHubConnectionError(
        "github_api_request_failed",
        "GitHub API request failed with HTTP 403",
      ),
      { operation: "create" },
    ),
    {
      code: "github_api_request_failed",
      detail: "GitHub API request failed with HTTP 403",
      definitive: true,
      uncertain: false,
    },
  );
  assert.deepEqual(
    githubDeliveryFailure(
      new GitHubConnectionError(
        "github_api_unavailable",
        "GitHub API request could not complete",
      ),
      { operation: "create" },
    ),
    {
      code: "github_api_unavailable",
      detail: "GitHub API request could not complete",
      definitive: false,
      uncertain: true,
    },
  );
  assert.deepEqual(
    githubDeliveryFailure(
      new GitHubConnectionError(
        "github_api_transient_failure",
        "GitHub API request temporarily failed with HTTP 429",
        { nextAttemptAt: 125_000, responseStatus: 429 },
      ),
      { operation: "create" },
    ),
    {
      code: "github_api_transient_failure",
      detail: "GitHub API request temporarily failed with HTTP 429",
      definitive: false,
      nextAttemptAt: 125_000,
      providerGate: true,
      responseStatus: 429,
      uncertain: false,
    },
  );
  assert.deepEqual(
    githubDeliveryFailure(
      new GitHubConnectionError(
        "github_api_transient_failure",
        "GitHub API request temporarily failed with HTTP 429",
        { responseStatus: 429 },
      ),
      { operation: "create" },
    ),
    {
      code: "github_api_transient_failure",
      detail: "GitHub API request temporarily failed with HTTP 429",
      definitive: false,
      providerGate: true,
      responseStatus: 429,
      uncertain: false,
    },
  );
  assert.deepEqual(
    githubDeliveryFailure(
      new GitHubConnectionError(
        "github_api_transient_failure",
        "GitHub API request temporarily failed with HTTP 503",
        { nextAttemptAt: 125_000, responseStatus: 503 },
      ),
      { operation: "create" },
    ),
    {
      code: "github_api_transient_failure",
      detail: "GitHub API request temporarily failed with HTTP 503",
      definitive: false,
      nextAttemptAt: 125_000,
      providerGate: true,
      responseStatus: 503,
      uncertain: true,
    },
  );
});

test("every create crash reconciles before another status, aggregate, or inline write", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-crash-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  const surfaces = ["commit_status", "aggregate_feedback", "inline_feedback"];
  for (const [index, surface] of surfaces.entries()) {
    let creates = 0;
    let reconciles = 0;
    let crash = true;
    const input = {
      connectionId: "connection-1",
      create: async () => {
        creates += 1;
        return 700 + index;
      },
      now: () => 10,
      onDefinitive() {},
      onSuccess() {
        if (crash) {
          throw new Error("injected local commit crash");
        }
      },
      reconcile: async () => {
        reconciles += 1;
        return 700 + index;
      },
      sourceId: `source-${index}`,
      surface: /** @type {any} */ (surface),
      target: `target-${index}`,
    };
    await assert.rejects(
      attemptGitHubDelivery(core, input),
      /injected local commit crash/,
    );
    assert.deepEqual(
      core.get(
        `SELECT external_id, reconciliation_required
         FROM github_delivery_attempts
         WHERE surface = ? AND source_id = ?`,
        surface,
        input.sourceId,
      ),
      { external_id: null, reconciliation_required: 1 },
    );
    crash = false;
    await attemptGitHubDelivery(core, input);
    assert.equal(creates, 1);
    assert.equal(reconciles, 1);
  }
});

test("uncertain recovery replays the persisted target after caller target drift", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-target-replay-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  let now = 0;
  /** @type {string[]} */
  const receivedTargets = [];
  const input = {
    connectionId: "connection-1",
    create: async (/** @type {string} */ target) => {
      receivedTargets.push(target);
      throw new GitHubConnectionError(
        "github_api_unavailable",
        "GitHub API request could not complete",
      );
    },
    now: () => now,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async (/** @type {string} */ target) => {
      receivedTargets.push(target);
      return 801;
    },
    sourceId: "persisted-target",
    surface: /** @type {const} */ ("aggregate_feedback"),
    target: '{"body":"original"}',
  };
  await attemptGitHubDelivery(core, input);
  now = 60_000;
  await attemptGitHubDelivery(core, {
    ...input,
    target: '{"body":"changed"}',
  });
  assert.deepEqual(receivedTargets, [
    '{"body":"original"}',
    '{"body":"original"}',
  ]);
  assert.equal(
    core.get(
      `SELECT target FROM github_delivery_attempts
       WHERE surface = 'aggregate_feedback'
         AND source_id = 'persisted-target'`,
    )?.target,
    '{"body":"original"}',
  );
});

test("corrected GitHub credentials preserve uncertainty and reconcile before create", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-delivery-recovery-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  core.run(
    `UPDATE github_commit_statuses
     SET publication_status = 'unavailable',
         error_code = 'github_api_request_failed',
         error_detail = 'GitHub API request failed with HTTP 403'`,
  );
  core.run(
    `UPDATE github_delivery_attempts
     SET attempt_count = 1,
         last_attempt_at = 10,
         reconciliation_required = 1,
         definitive = 1,
         response_status = 403,
         error_code = 'github_api_request_failed',
         error_detail = 'GitHub API request failed with HTTP 403'`,
  );
  core.run(
    `INSERT INTO github_delivery_provider_gates (
       connection_id, gate_until, error_code, error_detail
     ) VALUES (
       'connection-1', 3_600_000,
       'github_api_transient_failure',
       'GitHub API request temporarily failed with HTTP 429'
     )`,
  );

  core.transaction((transaction) => {
    resumeGitHubDeliveries(transaction, "connection-1", 20);
  });

  assert.deepEqual(
    core.get(
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
    core.get(
      `SELECT attempt_count, last_attempt_at, next_attempt_at,
              reconciliation_required, definitive, error_code, error_detail
       FROM github_delivery_attempts`,
    ),
    {
      attempt_count: 1,
      definitive: 0,
      error_code: null,
      error_detail: null,
      last_attempt_at: 10,
      next_attempt_at: 20,
      reconciliation_required: 1,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_delivery_provider_gates")
      ?.count,
    1,
  );
  let creates = 0;
  let reconciles = 0;
  let now = 20;
  const input = {
    connectionId: "connection-1",
    create: async () => {
      creates += 1;
      return 902;
    },
    now: () => now,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async () => {
      reconciles += 1;
      return 901;
    },
    sourceId: "evaluation-1:pending",
    surface: /** @type {const} */ ("commit_status"),
    target: /** @type {string} */ (
      core.get(
        `SELECT target FROM github_delivery_attempts
         WHERE surface = 'commit_status'`,
      )?.target
    ),
  };
  await attemptGitHubDelivery(core, input);
  assert.equal(creates, 0);
  assert.equal(reconciles, 0);
  now = 3_600_000;
  await attemptGitHubDelivery(core, input);
  assert.equal(creates, 0);
  assert.equal(reconciles, 1);
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_delivery_provider_gates")
      ?.count,
    0,
  );
});
