import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubCommitStatusService } from "../src/github-commit-status-service.js";
import {
  githubDeliveryFailure,
  nextGitHubDeliveryAttemptAt,
} from "../src/github-delivery.js";
import { resumeGitHubDeliveries } from "../src/github-delivery-recovery.js";
import { createForgejoCommitStatusService } from "../src/forgejo-commit-status-service.js";
import {
  forgejoDeliveryFailure,
  nextForgejoDeliveryAttemptAt,
} from "../src/forgejo-delivery.js";
import { resumeForgejoDeliveries } from "../src/forgejo-delivery-recovery.js";
import { openDurableCore } from "../src/durable-core.js";
import {
  isDefinitiveGitHubPollingFailure,
  nextGitHubAttemptAt,
} from "../src/github-polling-failure.js";
import {
  isDefinitiveForgejoPollingFailure,
  nextForgejoAttemptAt,
} from "../src/forgejo-polling-failure.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";

test("GitHub and Forgejo preserve provider deadlines across polling and delivery retries", () => {
  const attemptedAt = 10_000;
  const providerDeadline = 125_000;

  assert.equal(
    nextGitHubAttemptAt(attemptedAt, { nextAttemptAt: providerDeadline }),
    providerDeadline,
  );
  assert.equal(
    nextForgejoAttemptAt(attemptedAt, {
      nextAttemptAt: providerDeadline,
    }),
    providerDeadline,
  );
  assert.equal(
    nextGitHubDeliveryAttemptAt(attemptedAt, 1, {
      nextAttemptAt: providerDeadline,
    }),
    providerDeadline,
  );
  assert.equal(
    nextForgejoDeliveryAttemptAt(attemptedAt, 1, {
      nextAttemptAt: providerDeadline,
    }),
    providerDeadline,
  );
});

test("definitive provider failures wait for correction instead of becoming uncertain creates", () => {
  const githubFailure = githubDeliveryFailure(
    new GitHubConnectionError(
      "github_api_request_failed",
      "GitHub API request failed with HTTP 403",
      { responseStatus: 403 },
    ),
    { operation: "create" },
  );
  const forgejoFailure = forgejoDeliveryFailure(
    Object.assign(new Error("Forgejo publication route failed with HTTP 403"), {
      code: "forgejo_api_request_failed",
      responseStatus: 403,
    }),
    { operation: "create" },
  );

  assert.deepEqual(
    {
      github: {
        code: githubFailure.code,
        detail: githubFailure.detail,
        definitive: githubFailure.definitive,
        responseStatus: githubFailure.responseStatus,
        uncertain: githubFailure.uncertain,
      },
      forgejo: {
        code: forgejoFailure.code,
        detail: forgejoFailure.detail,
        definitive: forgejoFailure.definitive,
        responseStatus: forgejoFailure.responseStatus,
        uncertain: forgejoFailure.uncertain,
      },
    },
    {
      github: {
        code: "github_api_request_failed",
        detail: "GitHub API request failed with HTTP 403",
        definitive: true,
        responseStatus: 403,
        uncertain: false,
      },
      forgejo: {
        code: "forgejo_api_request_failed",
        detail: "Forgejo publication route failed with HTTP 403",
        definitive: true,
        responseStatus: 403,
        uncertain: false,
      },
    },
  );
});

test("definitive polling failures have no automatic next attempt", () => {
  assert.equal(
    isDefinitiveGitHubPollingFailure({
      code: "github_connection_credential_invalid",
    }),
    true,
  );
  assert.equal(
    isDefinitiveForgejoPollingFailure({
      code: "forgejo_connection_credential_invalid",
    }),
    true,
  );
  assert.equal(
    nextGitHubAttemptAt(10_000, {
      code: "github_connection_credential_invalid",
    }),
    null,
  );
  assert.equal(
    nextForgejoAttemptAt(10_000, {
      code: "forgejo_connection_credential_invalid",
    }),
    null,
  );
});

test("definitive publication failures remain visibly unavailable until correction resumes delivery", async (context) => {
  const cases = [
    {
      arrange: arrangeGitHubCommitStatus,
      createService: createGitHubCommitStatusService,
      error: new GitHubConnectionError(
        "github_api_request_failed",
        "GitHub API request failed with HTTP 403",
        { responseStatus: 403 },
      ),
      provider: "github",
      /** @param {any} transaction */
      resume(transaction) {
        resumeGitHubDeliveries(transaction, "connection-1", 100);
      },
      statusTable: "github_commit_statuses",
      deliveryTable: "github_delivery_attempts",
      statusSource: "evaluation-1:pending",
      externalId: 931,
    },
    {
      arrange: arrangeForgejoFeedback,
      createService: createForgejoCommitStatusService,
      error: Object.assign(new Error("Forgejo repository permission denied"), {
        code: "forgejo_repository_permission_denied",
      }),
      provider: "forgejo",
      /** @param {any} transaction */
      resume(transaction) {
        resumeForgejoDeliveries(
          transaction,
          "connection-1",
          100,
          "repository_authority",
          [101],
        );
      },
      statusTable: "forgejo_commit_statuses",
      deliveryTable: "forgejo_delivery_attempts",
      statusSource: "evaluation-1:failure",
      externalId: 932,
    },
  ];

  for (const scenario of cases) {
    const directory = mkdtempSync(
      join(tmpdir(), `quality-bar-provider-definitive-${scenario.provider}-`),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    scenario.arrange(core);
    let now = 0;
    let publishes = 0;
    const service = /** @type {any} */ (scenario.createService)(core, {
      cipher: {
        decrypt: () =>
          scenario.provider === "github"
            ? { client_id: "Iv1.client", pem: "pem" }
            : "pat",
      },
      externalOrigin: "https://quality-bar.example",
      ioPool: createIoExecutionPool(),
      now: () => now,
      verifier: {
        publishCommitStatus: async () => {
          publishes += 1;
          if (publishes === 1) {
            throw scenario.error;
          }
          return scenario.externalId;
        },
        reconcileCommitStatus: async () => null,
      },
    });

    await service.publishWaiting();
    assert.equal(publishes, 1);
    assert.deepEqual(
      core.get(
        `SELECT publication_status, error_code, error_detail
           FROM ${scenario.statusTable}
          WHERE evaluation_id = 'evaluation-1'`,
      ),
      {
        error_code: scenario.error.code,
        error_detail: scenario.error.message,
        publication_status: "unavailable",
      },
    );
    assert.deepEqual(
      core.get(
        `SELECT definitive, next_attempt_at, reconciliation_required,
                external_id, error_code, error_detail
           FROM ${scenario.deliveryTable}
          WHERE surface = 'commit_status'
            AND source_id = ?`,
        scenario.statusSource,
      ),
      {
        definitive: 1,
        error_code: scenario.error.code,
        error_detail: scenario.error.message,
        external_id: null,
        next_attempt_at: 0,
        reconciliation_required: 1,
      },
    );

    now = 1;
    await service.publishWaiting();
    assert.equal(publishes, 1);

    core.transaction((/** @type {any} */ transaction) => {
      scenario.resume(transaction);
    });
    now = 100;
    await service.publishWaiting();
    assert.equal(publishes, 2);
    assert.deepEqual(
      core.get(
        `SELECT publication_status, error_code, error_detail
           FROM ${scenario.statusTable}
          WHERE evaluation_id = 'evaluation-1'`,
      ),
      {
        error_code: null,
        error_detail: null,
        publication_status: "succeeded",
      },
    );
    assert.deepEqual(
      core.get(
        `SELECT definitive, next_attempt_at, reconciliation_required,
                external_id, error_code, error_detail
           FROM ${scenario.deliveryTable}
          WHERE surface = 'commit_status'
            AND source_id = ?`,
        scenario.statusSource,
      ),
      {
        definitive: 0,
        error_code: null,
        error_detail: null,
        external_id: scenario.externalId,
        next_attempt_at: 0,
        reconciliation_required: 0,
      },
    );
    service.destroy();
    core.close();
  }
});
