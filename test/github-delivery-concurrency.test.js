import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { resumeGitHubDeliveries } from "../src/github-delivery-recovery.js";
import {
  beginGitHubDeliveryAttempt,
  ensureGitHubDelivery,
  failGitHubDelivery,
} from "../src/github-delivery.js";
import {
  attemptGitHubDelivery,
  recordGitHubDeliveryHealth,
} from "../src/github-delivery-service.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";

test("retirement wins successful and failed in-flight delivery completions", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  for (const outcome of ["success", "failure"]) {
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    let publicationCommitted = false;
    const sourceId = `race-${outcome}`;
    const running = attemptGitHubDelivery(core, {
      connectionId: "connection-1",
      create: async () => {
        started.resolve(undefined);
        await release.promise;
        if (outcome === "failure") {
          throw new GitHubConnectionError(
            "github_api_unavailable",
            "GitHub API request could not complete",
          );
        }
        return 801;
      },
      now: () => 10,
      onDefinitive() {},
      onSuccess() {
        publicationCommitted = true;
      },
      reconcile: async () => null,
      sourceId,
      surface: "aggregate_feedback",
      target: `target-${outcome}`,
    });
    await started.promise;
    core.run(
      `UPDATE github_delivery_attempts
       SET generation = generation + 1,
           definitive = 1,
           error_code = 'github_connection_retired',
           error_detail =
             'GitHub delivery is unavailable because the GitHub Connection is retired'
       WHERE surface = 'aggregate_feedback' AND source_id = ?`,
      sourceId,
    );
    release.resolve(undefined);
    await running;
    assert.equal(publicationCommitted, false);
    assert.deepEqual(
      core.get(
        `SELECT definitive, error_code, error_detail
         FROM github_delivery_attempts
         WHERE surface = 'aggregate_feedback' AND source_id = ?`,
        sourceId,
      ),
      {
        definitive: 1,
        error_code: "github_connection_retired",
        error_detail:
          "GitHub delivery is unavailable because the GitHub Connection is retired",
      },
    );
  }
});

test("provider gate retains the error that owns the winning deadline", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-gate-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    arrangeGitHubCommitStatus(core);
    const long = ensureGitHubDelivery(
      core,
      "aggregate_feedback",
      "gate-long",
      "target-long",
    );
    const short = ensureGitHubDelivery(
      core,
      "inline_feedback",
      "gate-short",
      "target-short",
    );
    assert.equal(
      beginGitHubDeliveryAttempt(core, "connection-1", long, 0, "create"),
      true,
    );
    assert.equal(
      beginGitHubDeliveryAttempt(core, "connection-1", short, 0, "create"),
      true,
    );
    failGitHubDelivery(
      core,
      long,
      0,
      {
        code: "github_api_transient_failure",
        definitive: false,
        detail: "long gate",
        nextAttemptAt: 3_600_000,
        providerGate: true,
        uncertain: false,
      },
      "connection-1",
      () => {},
    );
    failGitHubDelivery(
      core,
      short,
      0,
      {
        code: "github_api_transient_failure",
        definitive: false,
        detail: "short gate",
        nextAttemptAt: 60_000,
        providerGate: true,
        uncertain: false,
      },
      "connection-1",
      () => {},
    );
    assert.deepEqual(core.get("SELECT * FROM github_delivery_provider_gates"), {
      connection_id: "connection-1",
      error_code: "github_api_transient_failure",
      error_detail: "long gate",
      gate_until: 3_600_000,
    });
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("newer successful verification fences an older in-flight delivery failure", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-delivery-authority-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeGitHubCommitStatus(core);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const running = attemptGitHubDelivery(core, {
    connectionId: "connection-1",
    create: async () => {
      started.resolve(undefined);
      await release.promise;
      throw new GitHubConnectionError(
        "github_api_request_failed",
        "GitHub API request failed with HTTP 403",
        { responseStatus: 403 },
      );
    },
    now: () => 10,
    onDefinitive(transaction, failure, attemptedAt) {
      recordGitHubDeliveryHealth(
        transaction,
        "connection-1",
        attemptedAt,
        failure,
      );
    },
    onSuccess() {},
    reconcile: async () => null,
    sourceId: "authority-race",
    surface: "aggregate_feedback",
    target: "authority-target",
  });
  await started.promise;
  core.run(
    `UPDATE github_connections
     SET health = 'healthy',
         health_error_code = NULL,
         health_error_message = NULL,
         verified_at = 20
     WHERE id = 'connection-1'`,
  );
  release.resolve(undefined);
  await running;
  assert.deepEqual(
    core.get(
      `SELECT health, health_error_code, health_error_message, verified_at
       FROM github_connections WHERE id = 'connection-1'`,
    ),
    {
      health: "healthy",
      health_error_code: null,
      health_error_message: null,
      verified_at: 20,
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT definitive, reconciliation_required, error_code, error_detail
       FROM github_delivery_attempts
       WHERE surface = 'aggregate_feedback' AND source_id = 'authority-race'`,
    ),
    {
      definitive: 0,
      error_code: null,
      error_detail: null,
      reconciliation_required: 1,
    },
  );
});

test("surface validation failures do not poison GitHub Connection health", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-delivery-health-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    arrangeGitHubCommitStatus(core);
    core.transaction((transaction) => {
      recordGitHubDeliveryHealth(transaction, "connection-1", 10, {
        code: "github_api_request_failed",
        detail: "GitHub API request failed with HTTP 422",
        responseStatus: 422,
      });
    });
    assert.deepEqual(
      core.get(
        `SELECT health, health_error_code, health_error_message
         FROM github_connections`,
      ),
      {
        health: "healthy",
        health_error_code: null,
        health_error_message: null,
      },
    );
    const admitted = core.get(
      `SELECT target FROM github_delivery_attempts
       WHERE surface = 'commit_status'`,
    );
    assert.equal(typeof admitted?.target, "string");
    const delivery = ensureGitHubDelivery(
      core,
      "commit_status",
      "evaluation-1:pending",
      /** @type {string} */ (admitted?.target),
    );
    assert.equal(
      beginGitHubDeliveryAttempt(core, "connection-1", delivery, 10, "create"),
      true,
    );
    failGitHubDelivery(
      core,
      delivery,
      10,
      {
        code: "github_api_request_failed",
        definitive: true,
        detail: "GitHub API request failed with HTTP 422",
        nextAttemptAt: null,
        providerGate: false,
        responseStatus: 422,
        uncertain: false,
      },
      "connection-1",
      (transaction) => {
        transaction.run(
          `UPDATE github_commit_statuses
           SET publication_status = 'unavailable',
               error_code = 'github_api_request_failed',
               error_detail = 'GitHub API request failed with HTTP 422'
           WHERE evaluation_id = 'evaluation-1'`,
        );
      },
    );
    core.transaction((transaction) => {
      resumeGitHubDeliveries(transaction, "connection-1", 20);
    });
    assert.deepEqual(
      core.get(
        `SELECT definitive, response_status, error_code
         FROM github_delivery_attempts
         WHERE surface = 'commit_status'`,
      ),
      {
        definitive: 1,
        error_code: "github_api_request_failed",
        response_status: 422,
      },
    );
    assert.equal(
      core.get("SELECT publication_status FROM github_commit_statuses")
        ?.publication_status,
      "unavailable",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
