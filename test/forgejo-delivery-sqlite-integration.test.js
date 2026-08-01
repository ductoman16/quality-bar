import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  attemptForgejoDelivery,
  recordForgejoDeliveryHealth,
} from "../src/forgejo-delivery-service.js";
import { resumeForgejoDeliveries } from "../src/forgejo-delivery-recovery.js";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.js";

test("uncertain Forgejo delivery reconciles persisted state after restart and recreates only after proven absence", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-delivery-"),
  );
  const path = join(directory, "quality-bar.sqlite3");
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  let core = openDurableCore(path);
  arrangeForgejoFeedback(core);
  let now = 10;
  /** @type {[string, string][]} */
  const operations = [];
  const input = {
    connectionId: "connection-1",
    create: async (/** @type {string} */ target) => {
      operations.push(["create", target]);
      if (operations.length === 1) {
        throw Object.assign(new Error("Forgejo response was lost"), {
          code: "forgejo_api_unavailable",
        });
      }
      return 901;
    },
    now: () => now,
    onDefinitive() {},
    onSuccess() {},
    reconcile: async (/** @type {string} */ target) => {
      operations.push(["reconcile", target]);
      return null;
    },
    sourceId: "evaluation-1:blocking",
    surface: /** @type {const} */ ("commit_status"),
    target: '{"state":"blocking"}',
  };
  await attemptForgejoDelivery(core, input);
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, reconciliation_required, next_attempt_at
       FROM forgejo_delivery_attempts
       WHERE surface = 'commit_status' AND source_id = ?`,
      input.sourceId,
    ),
    { attempt_count: 1, next_attempt_at: 60_010, reconciliation_required: 1 },
  );
  core.close();

  core = openDurableCore(path);
  context.after(() => core.close());
  now = 60_010;
  await attemptForgejoDelivery(core, {
    ...input,
    target: '{"state":"changed"}',
  });
  assert.deepEqual(operations, [
    ["create", '{"state":"blocking"}'],
    ["reconcile", '{"state":"blocking"}'],
    ["create", '{"state":"changed"}'],
  ]);
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, external_id, reconciliation_required, target
       FROM forgejo_delivery_attempts
       WHERE surface = 'commit_status' AND source_id = ?`,
      input.sourceId,
    ),
    {
      attempt_count: 3,
      external_id: 901,
      reconciliation_required: 0,
      target: '{"state":"changed"}',
    },
  );
});

test("Forgejo delivery surfaces retry independently", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-surfaces-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  const deliveries = /** @type {const} */ ([
    {
      externalId: 902,
      sourceId: "evaluation-1",
      surface: "aggregate_feedback",
    },
    {
      externalId: null,
      sourceId: "finding-inline",
      surface: "inline_feedback",
    },
  ]);
  for (const { externalId, sourceId, surface } of deliveries) {
    await attemptForgejoDelivery(core, {
      connectionId: "connection-1",
      create: async () => {
        if (externalId === null) {
          throw Object.assign(new Error("Forgejo rate limit is active"), {
            code: "forgejo_api_rate_limited",
            nextAttemptAt: 125_000,
            responseStatus: 429,
          });
        }
        return externalId;
      },
      now: () => 10,
      onDefinitive() {},
      onSuccess() {},
      reconcile: async () => null,
      sourceId,
      surface: /** @type {any} */ (surface),
      target: `target-${sourceId}`,
    });
  }
  assert.deepEqual(
    core.all(
      `SELECT surface, external_id, error_code, next_attempt_at
       FROM forgejo_delivery_attempts
       WHERE surface != 'commit_status'
       ORDER BY surface`,
    ),
    [
      {
        error_code: null,
        external_id: 902,
        next_attempt_at: 0,
        surface: "aggregate_feedback",
      },
      {
        error_code: "forgejo_api_rate_limited",
        external_id: null,
        next_attempt_at: 125_000,
        surface: "inline_feedback",
      },
    ],
  );
  assert.deepEqual(core.get("SELECT * FROM forgejo_delivery_provider_gates"), {
    connection_id: "connection-1",
    error_code: "forgejo_api_rate_limited",
    error_detail: "Forgejo rate limit is active",
    gate_until: 125_000,
  });
});

test("a definitive delivery identity conflict does not misdiagnose connection health", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-identity-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);

  await attemptForgejoDelivery(core, {
    connectionId: "connection-1",
    create: async () => 901,
    now: () => 10,
    onDefinitive: (transaction, failure, attemptedAt) => {
      transaction.run(
        `UPDATE forgejo_commit_statuses
         SET publication_status = 'unavailable', error_code = ?,
             error_detail = ?`,
        failure.code,
        failure.detail,
      );
      recordForgejoDeliveryHealth(
        transaction,
        "connection-1",
        attemptedAt,
        failure,
      );
    },
    onSuccess() {},
    reconcile: async () => {
      throw Object.assign(new Error("duplicate source identities"), {
        code: "forgejo_delivery_identity_conflict",
      });
    },
    sourceId: "evaluation-1:blocking",
    surface: "commit_status",
    target: '{"state":"blocking"}',
  });
  core.run(
    `UPDATE forgejo_delivery_attempts
     SET reconciliation_required = 1, external_id = NULL,
         next_attempt_at = 0, generation = 0, attempt_count = 0,
         last_attempt_at = NULL, connection_id = NULL,
         authority_verified_at = NULL
     WHERE surface = 'commit_status'`,
  );
  await attemptForgejoDelivery(core, {
    connectionId: "connection-1",
    create: async () => 901,
    now: () => 20,
    onDefinitive: (transaction, failure, attemptedAt) => {
      recordForgejoDeliveryHealth(
        transaction,
        "connection-1",
        attemptedAt,
        failure,
      );
    },
    onSuccess() {},
    reconcile: async () => {
      throw Object.assign(new Error("duplicate source identities"), {
        code: "forgejo_delivery_identity_conflict",
      });
    },
    sourceId: "evaluation-1:blocking",
    surface: "commit_status",
    target: '{"state":"blocking"}',
  });

  assert.equal(
    core.get(
      "SELECT health FROM forgejo_connections WHERE id = ?",
      "connection-1",
    )?.health,
    "healthy",
  );
});

test("corrected Forgejo authority visibly resumes definitive delivery without changing Evaluation truth", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-resume-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrangeForgejoFeedback(core);
  core.run(
    `UPDATE forgejo_commit_statuses
     SET publication_status = 'unavailable',
         error_code = 'forgejo_api_request_failed',
         error_detail = 'Forgejo publication route failed with HTTP 403'`,
  );
  core.run(
    `UPDATE forgejo_delivery_attempts
     SET connection_id = 'connection-1', authority_verified_at = 1,
         attempt_count = 1, last_attempt_at = 10,
         reconciliation_required = 1, definitive = 1,
         response_status = 403,
         error_code = 'forgejo_api_request_failed',
         error_detail = 'Forgejo publication route failed with HTTP 403'
     WHERE surface = 'commit_status'`,
  );
  core.run(
    `INSERT INTO forgejo_delivery_provider_gates
       (connection_id, gate_until, error_code, error_detail)
     VALUES ('connection-1', 3_600_000, 'forgejo_api_rate_limited', 'rate')`,
  );

  core.transaction((transaction) =>
    resumeForgejoDeliveries(transaction, "connection-1", 20),
  );

  assert.deepEqual(
    core.get(
      `SELECT publication_status, error_code, error_detail
       FROM forgejo_commit_statuses`,
    ),
    { error_code: null, error_detail: null, publication_status: "waiting" },
  );
  assert.deepEqual(
    core.get(
      `SELECT definitive, error_code, next_attempt_at,
              reconciliation_required
       FROM forgejo_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    {
      definitive: 0,
      error_code: null,
      next_attempt_at: 20,
      reconciliation_required: 1,
    },
  );
  assert.equal(
    core.get("SELECT outcome FROM evaluation_results")?.outcome,
    "blocking",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_delivery_provider_gates")
      ?.count,
    0,
  );
});
