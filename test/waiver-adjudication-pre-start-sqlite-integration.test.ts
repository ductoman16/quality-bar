import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createIoExecutionPool } from "../src/io-execution-pool.ts";
import { prepareReviewRunCheckout } from "../src/review/review-run-checkout.ts";
import { createWaiverAdjudicationClaimService } from "../src/waiver/waiver-adjudication-claim.ts";
import { executeWaiverAdjudication } from "../src/waiver/waiver-adjudication-execution.ts";
import { createWaiverAdjudicationRecoveryService } from "../src/waiver/waiver-adjudication-recovery.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function createFixture(context: import("node:test").TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-pre-start-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "Exact immutable exception rationale.",
        },
      ],
    },
  });
  return core;
}

function createIoPool(context: import("node:test").TestContext) {
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure() {
      assert.fail("Unexpected background I/O failure");
    },
  });
  context.after(() => ioPool.close());
  return ioPool;
}

test("pre-start checkout failures persist the one-minute and five-minute retry schedule before exhaustion", (context) => {
  const core = createFixture(context);
  let currentTime = 20;
  let worker = 0;
  const claims = createWaiverAdjudicationClaimService(core, {
    clearInterval() {},
    createWorkerId: () => `worker-${++worker}`,
    now: () => currentTime,
    setInterval: () => 1,
  });
  const failure = Object.assign(new Error("Checkout preparation failed"), {
    code: "review_run_checkout_failed",
  });

  const first = claims.claimNext();
  assert.ok(first);
  assert.deepEqual(claims.recordPreStartFailure(first, failure), {
    attemptNumber: 1,
    exhausted: false,
    nextAttemptAt: 60_020,
    retryCycle: 1,
  });
  currentTime = 60_019;
  assert.equal(claims.claimNext(), undefined);
  currentTime = 60_020;
  const second = claims.claimNext();
  assert.ok(second);
  assert.deepEqual(claims.recordPreStartFailure(second, failure), {
    attemptNumber: 2,
    exhausted: false,
    nextAttemptAt: 360_020,
    retryCycle: 1,
  });
  currentTime = 360_020;
  const third = claims.claimNext();
  assert.ok(third);
  assert.deepEqual(claims.recordPreStartFailure(third, failure), {
    attemptNumber: 3,
    exhausted: true,
    nextAttemptAt: null,
    retryCycle: 1,
  });
  assert.deepEqual(
    core.get(
      `SELECT codex_execution_queue.retry_state,
              waiver_adjudications.execution_status,
              waiver_adjudications.started_at
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = 'adjudication-1'`,
    ),
    {
      execution_status: "queued",
      retry_state: "exhausted",
      started_at: null,
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT attempt_number, failed_at, exhausted
       FROM waiver_adjudication_pre_start_attempts
       WHERE waiver_adjudication_id = 'adjudication-1'
       ORDER BY attempt_number`,
    ),
    [
      { attempt_number: 1, exhausted: 0, failed_at: 20 },
      { attempt_number: 2, exhausted: 0, failed_at: 60_020 },
      { attempt_number: 3, exhausted: 1, failed_at: 360_020 },
    ],
  );
  assert.equal(claims.claimNext(), undefined);
});

test("the production executor records checkout failure before Codex launch", async (context) => {
  const core = createFixture(context);
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "checkout-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  let launched = false;
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, claim, {
        claimService: claims,
        evidenceService: {},
        ioPool: createIoPool(context),
        async prepareCheckout() {
          throw Object.assign(new Error("Checkout preparation failed"), {
            code: "review_run_checkout_failed",
          });
        },
        resultService: {},
        async runCodex() {
          launched = true;
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_checkout_failed",
  );
  assert.equal(launched, false);
  assert.deepEqual(
    core.get(
      `SELECT ready_at, worker_id, lease_expires_at
       FROM codex_execution_queue WHERE work_id = 'adjudication-1'`,
    ),
    {
      lease_expires_at: 20,
      ready_at: 60_020,
      worker_id: "checkout-worker",
    },
  );
});

test("the production executor exhausts definitive checkout permission failure immediately", async (context) => {
  const core = createFixture(context);
  const checkoutRoot = mkdtempSync(join(tmpdir(), "quality-bar-denied-"));
  context.after(() => rmSync(checkoutRoot, { force: true, recursive: true }));
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "permission-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, claim, {
        checkoutRoot,
        claimService: claims,
        evidenceService: {},
        ioPool: createIoPool(context),
        prepareCheckout: (input: any) =>
          prepareReviewRunCheckout({
            ...input,
            spawnProcess: (() => {
              const child = Object.assign(new EventEmitter(), {
                kill() {},
                stderr: new PassThrough(),
              });
              queueMicrotask(() => {
                child.stderr.end(
                  "fatal: unable to access repository: returned error: 403\n",
                );
                child.emit("close", 128, null);
              });
              return child;
            }) as any,
          }),
        resultService: {},
        runCodex: () => assert.fail("Codex launched after checkout denial"),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "repository_permission_denied" &&
      error.message ===
        "Repository permission denied during Waiver Adjudication checkout",
  );
  assert.deepEqual(
    core.all(
      `SELECT attempt_number, error_code, exhausted
       FROM waiver_adjudication_pre_start_attempts`,
    ),
    [
      {
        attempt_number: 1,
        error_code: "repository_permission_denied",
        exhausted: 1,
      },
    ],
  );
});

test("provider rate gates block exceptional recovery without mutation", (context) => {
  const core = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 1, 20, 'review_run_checkout_failed',
       'Checkout preparation failed.', 1
     )`,
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
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, api_profile, principal_id,
       principal_login, permissions, capabilities, affected_repository_ids,
       repository_checks, repositories, verified_at
     ) VALUES (
       'verification-1', 'connection-1', 'onboarding', 'success',
       'github-rest:2026-03-10', 91, 'operator', '{}', '{}', '[101]',
       '[{"repository_id":101,"outcome":"success"}]', '[{"id":101}]', 1
     )`,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, verification_id, forge_repository_id,
       name, api_url, web_url
     ) VALUES (
       'repository-1', 'connection-1', 'verification-1', 101,
       'operator/repository', 'https://api.github.com/repos/operator/repository',
       'https://github.com/operator/repository'
     )`,
  );
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status, last_success_at,
       error_code, error_message, rate_gate_until, next_attempt_at, snapshot
     ) VALUES (
       'connection-1', 101, 'complete', 1,
       'provider_rate_limited', 'GitHub rate limit is active.', 100, 100, '[]'
     )`,
  );
  const recoveries = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () => assert.fail("rate gate created work"),
    now: () => 30,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  assert.throws(
    () =>
      recoveries.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "rate-gated-recovery",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "provider_rate_limited",
  );
  assert.equal(
    core.get(
      `SELECT retry_state FROM codex_execution_queue
       WHERE work_id = 'adjudication-1'`,
    )?.retry_state,
    "exhausted",
  );
});

test("Forgejo recovery health gate preserves the latest verification failure", (context) => {
  const core = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 1, 20, 'review_run_checkout_failed',
       'Checkout preparation failed.', 1
     )`,
  );
  core.run(
    `INSERT INTO forgejo_connections (
       id, base_url, api_profile, reported_version, principal_id,
       principal_login, scopes, capabilities, health, created_at, verified_at
     ) VALUES (
       'forgejo-1', 'https://forgejo.example.test',
       'forgejo', '11.0.0', 7, 'operator',
       '[]', '{}', 'error', 1, 2
     )`,
  );
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, profile, reported_version, principal,
       scopes, capabilities, repositories, error_code, error_message,
       verified_at
     ) VALUES (
       'forgejo-success', 'forgejo-1', 'onboarding', 'forgejo', '11.0.0',
       '{"id":7,"login":"operator"}', '[]', '{}', '[]', NULL, NULL, 1
     )`,
  );
  core.run(
    `INSERT INTO forgejo_repositories (
       repository_id, connection_id, verification_id, forge_repository_id,
       name, api_url, web_url
     ) VALUES (
       'repository-1', 'forgejo-1', 'forgejo-success', 11,
       'operator/repository',
       'https://forgejo.example.test/api/v1/repos/operator/repository',
       'https://forgejo.example.test/operator/repository'
     )`,
  );
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, error_code, error_message, verified_at
     ) VALUES (
       'forgejo-failure', 'forgejo-1', 'rotation',
       'forgejo_connection_credential_invalid',
       'Forgejo Connection credential is invalid.', 2
     )`,
  );
  const recoveries = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () => assert.fail("health gate created work"),
    now: () => 30,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  assert.throws(
    () =>
      recoveries.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "forgejo-health-recovery",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_connection_credential_invalid" &&
      error.message === "Forgejo Connection credential is invalid.",
  );
  assert.equal(
    core.get(
      `SELECT retry_state FROM codex_execution_queue
       WHERE work_id = 'adjudication-1'`,
    )?.retry_state,
    "exhausted",
  );
});
