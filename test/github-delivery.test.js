import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { resumeGitHubDeliveries } from "../src/github-delivery-recovery.js";
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
      uncertain: false,
    },
  );
});

test("corrected GitHub credentials resume definitive deliveries and clear the provider gate", (context) => {
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
         definitive = 1,
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
              definitive, error_code, error_detail
       FROM github_delivery_attempts`,
    ),
    {
      attempt_count: 1,
      definitive: 0,
      error_code: null,
      error_detail: null,
      last_attempt_at: 10,
      next_attempt_at: 20,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_delivery_provider_gates")
      ?.count,
    0,
  );
});
