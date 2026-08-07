import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { attemptGitHubDelivery } from "../src/github-delivery-service.js";
import { createGitHubPollingService } from "../src/github-polling.js";
import { attemptForgejoDelivery } from "../src/forgejo-delivery-service.js";
import { createForgejoPollingService } from "../src/forgejo-polling.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";

/**
 * @param {ReturnType<typeof openDurableCore>} core
 * @param {(sql: string) => boolean} shouldFail
 */
function failureInjectingCore(core, shouldFail) {
  return {
    ...core,
    /** @param {(transaction: any) => unknown} callback */
    transaction(callback) {
      return core.transaction((transaction) =>
        callback({
          ...transaction,
          /** @param {string} sql @param {...import("node:sqlite").SQLInputValue} parameters */
          run(sql, ...parameters) {
            if (shouldFail(sql)) {
              transaction.run("PRAGMA query_only = ON");
            }
            return transaction.run(sql, ...parameters);
          },
        }),
      );
    },
  };
}

test("a provider delivery write failure leaves the exact pending identity without partial success", async (context) => {
  const cases = [
    {
      arrange: arrangeGitHubCommitStatus,
      attempt: attemptGitHubDelivery,
      error: new GitHubConnectionError(
        "github_api_unavailable",
        "GitHub API request could not complete",
      ),
      table: "github_delivery_attempts",
    },
    {
      arrange: arrangeForgejoFeedback,
      attempt: attemptForgejoDelivery,
      error: Object.assign(
        new Error("Forgejo publication route is unavailable"),
        {
          code: "forgejo_api_unavailable",
        },
      ),
      table: "forgejo_delivery_attempts",
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-provider-delivery-failure-${index}-`),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    let coreClosed = false;
    context.after(() => {
      if (!coreClosed) {
        core.close();
      }
    });
    scenario.arrange(core);
    let failWrites = false;
    const failingCore = failureInjectingCore(
      core,
      (sql) =>
        failWrites &&
        sql.includes(`UPDATE ${scenario.table}`) &&
        sql.includes("SET next_attempt_at = ?"),
    );

    await scenario.attempt(failingCore, {
      connectionId: "connection-1",
      create: async () => 701,
      now: () => 0,
      onDefinitive() {},
      onSuccess() {},
      reconcile: async () => null,
      repositoryId: "repository-1",
      sourceId: "provider-recovery-success",
      surface: "commit_status",
      target: '{"state":"success"}',
    });
    failWrites = true;

    const observed = await scenario
      .attempt(failingCore, {
        connectionId: "connection-1",
        create: async () => {
          throw scenario.error;
        },
        now: () => 10,
        onDefinitive() {},
        onSuccess() {},
        reconcile: async () => null,
        repositoryId: "repository-1",
        sourceId: "provider-recovery-source",
        surface: "commit_status",
        target: '{"state":"pending"}',
      })
      .then(
        () => null,
        (error) => error,
      );
    assert.ok(observed instanceof Error);
    assert.equal(
      "code" in observed ? observed.code : undefined,
      "storage_unavailable",
    );
    assert.equal(observed.message, "SQLite durable write failed");
    core.close();
    coreClosed = true;
    const observer = openDurableCore(join(directory, "quality-bar.sqlite3"));
    context.after(() => observer.close());
    assert.deepEqual(
      observer.get(
        `SELECT attempt_count, definitive, error_code, external_id,
                next_attempt_at, reconciliation_required
           FROM ${scenario.table}
          WHERE surface = 'commit_status'
            AND source_id = 'provider-recovery-source'`,
      ),
      {
        attempt_count: 1,
        definitive: 0,
        error_code: null,
        external_id: null,
        next_attempt_at: 0,
        reconciliation_required: 1,
      },
    );
    assert.deepEqual(
      observer.get(
        `SELECT attempt_count, definitive, error_code, external_id,
                next_attempt_at, reconciliation_required
           FROM ${scenario.table}
          WHERE surface = 'commit_status'
            AND source_id = 'provider-recovery-success'`,
      ),
      {
        attempt_count: 1,
        definitive: 0,
        error_code: null,
        external_id: 701,
        next_attempt_at: 0,
        reconciliation_required: 0,
      },
    );
  }
});

test("a polling snapshot write failure records no provider gate or partial snapshot", async (context) => {
  const cases = [
    {
      arrange: arrangeGitHubCommitStatus,
      create: createGitHubPollingService,
      fetchPullRequests: async () => [],
      table: "github_repository_polls",
      repository: { id: 101 },
    },
    {
      arrange: arrangeForgejoFeedback,
      create: createForgejoPollingService,
      fetchPullRequests: async () => [],
      table: "forgejo_repository_polls",
      repository: { id: 101, full_name: "operator/repository" },
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-provider-polling-failure-${index}-`),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    let coreClosed = false;
    context.after(() => {
      if (!coreClosed) {
        core.close();
      }
    });
    scenario.arrange(core);
    let failWrites = false;
    const failingCore = failureInjectingCore(
      core,
      (sql) =>
        failWrites && sql.includes(scenario.table) && sql.includes("snapshot"),
    );
    let now = 0;
    const polling = scenario.create(failingCore, {
      fetchPullRequests: scenario.fetchPullRequests,
      now: () => now,
      recordOwningFailure() {},
    });

    await polling.reconcile({
      connection: { id: "connection-1" },
      credential: {},
      repositories: [scenario.repository],
    });
    const successfulSnapshot = core.get(
      `SELECT baseline_status, error_code, next_attempt_at,
              rate_gate_until, snapshot
         FROM ${scenario.table}
        WHERE connection_id = 'connection-1' AND forge_repository_id = 101`,
    );
    assert.equal(successfulSnapshot?.baseline_status, "complete");
    failWrites = true;
    now = 120_000;

    const observed = await polling
      .reconcile({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [scenario.repository],
      })
      .then(
        () => null,
        (error) => error,
      );
    assert.ok(observed instanceof Error);
    assert.equal(
      "code" in observed ? observed.code : undefined,
      "storage_unavailable",
    );
    assert.equal(observed.message, "SQLite durable write failed");
    core.close();
    coreClosed = true;
    const observer = openDurableCore(join(directory, "quality-bar.sqlite3"));
    context.after(() => observer.close());
    assert.deepEqual(
      observer.get(
        `SELECT baseline_status, error_code, next_attempt_at,
                rate_gate_until, snapshot
           FROM ${scenario.table}
          WHERE connection_id = 'connection-1' AND forge_repository_id = 101`,
      ),
      successfulSnapshot,
    );
    assert.equal(
      observer.get(
        "SELECT count(*) AS count FROM quality_bar_metadata WHERE key LIKE '%poll_gate:connection-1'",
      )?.count,
      0,
    );
  }
});

test("a provider gate write failure rolls back the delivery failure and gate together", async (context) => {
  const cases = [
    {
      arrange: arrangeGitHubCommitStatus,
      attempt: attemptGitHubDelivery,
      error: new GitHubConnectionError(
        "github_api_transient_failure",
        "GitHub API request temporarily failed with HTTP 429",
        { nextAttemptAt: 60_000, responseStatus: 429 },
      ),
      deliveryTable: "github_delivery_attempts",
      gateTable: "github_delivery_provider_gates",
    },
    {
      arrange: arrangeForgejoFeedback,
      attempt: attemptForgejoDelivery,
      error: Object.assign(new Error("Forgejo API rate limit is active"), {
        code: "forgejo_api_rate_limited",
        nextAttemptAt: 60_000,
      }),
      deliveryTable: "forgejo_delivery_attempts",
      gateTable: "forgejo_delivery_provider_gates",
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-provider-gate-failure-${index}-`),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    let coreClosed = false;
    context.after(() => {
      if (!coreClosed) {
        core.close();
      }
    });
    scenario.arrange(core);
    const failingCore = failureInjectingCore(core, (sql) =>
      sql.includes(`INSERT INTO ${scenario.gateTable}`),
    );
    const observed = await scenario
      .attempt(failingCore, {
        connectionId: "connection-1",
        create: async () => {
          throw scenario.error;
        },
        now: () => 0,
        onDefinitive() {},
        onSuccess() {},
        reconcile: async () => null,
        repositoryId: "repository-1",
        sourceId: "provider-gate-write-failure",
        surface: "commit_status",
        target: '{"state":"pending"}',
      })
      .then(
        () => null,
        (error) => error,
      );
    assert.ok(observed instanceof Error);
    assert.equal(
      "code" in observed ? observed.code : undefined,
      "storage_unavailable",
    );
    assert.equal(observed.message, "SQLite durable write failed");
    core.close();
    coreClosed = true;
    const observer = openDurableCore(join(directory, "quality-bar.sqlite3"));
    context.after(() => observer.close());
    assert.deepEqual(
      observer.get(
        `SELECT attempt_count, definitive, error_code, external_id,
                next_attempt_at, reconciliation_required
           FROM ${scenario.deliveryTable}
          WHERE surface = 'commit_status'
            AND source_id = 'provider-gate-write-failure'`,
      ),
      {
        attempt_count: 1,
        definitive: 0,
        error_code: null,
        external_id: null,
        next_attempt_at: 0,
        reconciliation_required: 1,
      },
    );
    assert.equal(
      observer.get(`SELECT count(*) AS count FROM ${scenario.gateTable}`)
        ?.count,
      0,
    );
  }
});
