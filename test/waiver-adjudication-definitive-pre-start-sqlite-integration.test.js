import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { prepareReviewRunCheckout } from "../src/review-run-checkout.js";
import { createWaiverAdjudicationClaimService } from "../src/waiver-adjudication-claim.js";
import { executeWaiverAdjudication } from "../src/waiver-adjudication-execution.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/**
 * @param {import("node:test").TestContext} context
 * @param {{createWorkerId?: () => string, now?: () => number}} [options]
 */
function createFixture(
  context,
  { createWorkerId = () => "definitive-worker", now = () => 20 } = {},
) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-definitive-pre-start-"),
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
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId,
    now,
  });
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure() {
      assert.fail("Unexpected background I/O failure");
    },
  });
  context.after(() => ioPool.close());
  return { claims, core, ioPool };
}

/** @param {any} core @param {string} errorCode */
function assertOneExhaustedAttempt(core, errorCode) {
  assert.deepEqual(
    core.all(
      `SELECT attempt_number, error_code, exhausted
       FROM waiver_adjudication_pre_start_attempts`,
    ),
    [{ attempt_number: 1, error_code: errorCode, exhausted: 1 }],
  );
}

test("the production executor exhausts a definitive pre-launch configuration failure", async (context) => {
  const { claims, core, ioPool } = createFixture(context);
  const claim = claims.claimNext();
  assert.ok(claim);
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, claim, {
        claimService: claims,
        evidenceService: {},
        ioPool,
        async prepareCheckout() {
          return { path: "/checkout", remove() {} };
        },
        resultService: {},
        async runCodex() {
          throw Object.assign(new Error("Codex model is unsupported"), {
            code: "codex_model_unsupported",
          });
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_model_unsupported",
  );
  assertOneExhaustedAttempt(core, "codex_model_unsupported");
});

test("the production executor exhausts checkout filesystem failure immediately", async (context) => {
  const { claims, core, ioPool } = createFixture(context);
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-filesystem-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const checkoutRoot = join(directory, "not-a-directory");
  writeFileSync(checkoutRoot, "occupied");
  const claim = claims.claimNext();
  assert.ok(claim);
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, claim, {
        checkoutRoot,
        claimService: claims,
        evidenceService: {},
        ioPool,
        resultService: {},
        runCodex: () => assert.fail("Codex launched after filesystem failure"),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "filesystem_unavailable",
  );
  assertOneExhaustedAttempt(core, "filesystem_unavailable");
});

test("the production executor exhausts an unrecognized definitive Git failure", async (context) => {
  const { claims, core, ioPool } = createFixture(context);
  const checkoutRoot = mkdtempSync(join(tmpdir(), "quality-bar-git-failed-"));
  context.after(() => rmSync(checkoutRoot, { force: true, recursive: true }));
  const claim = claims.claimNext();
  assert.ok(claim);
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, claim, {
        checkoutRoot,
        claimService: claims,
        evidenceService: {},
        ioPool,
        prepareCheckout: (/** @type {any} */ input) =>
          prepareReviewRunCheckout({
            ...input,
            spawnProcess: /** @type {any} */ (
              () => {
                const child = Object.assign(new EventEmitter(), {
                  kill() {},
                  stderr: new PassThrough(),
                });
                queueMicrotask(() => {
                  child.stderr.end("fatal: remote helper rejected request\n");
                  child.emit("close", 128, null);
                });
                return child;
              }
            ),
          }),
        resultService: {},
        runCodex: () => assert.fail("Codex launched after Git failure"),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_checkout_failed_definitive",
  );
  assertOneExhaustedAttempt(core, "review_run_checkout_failed_definitive");
});

test("production Git DNS failure receives the complete transient retry schedule", async (context) => {
  let currentTime = 20;
  let worker = 0;
  const { claims, core, ioPool } = createFixture(context, {
    createWorkerId: () => `transient-worker-${++worker}`,
    now: () => currentTime,
  });
  const checkoutRoot = mkdtempSync(join(tmpdir(), "quality-bar-git-dns-"));
  context.after(() => rmSync(checkoutRoot, { force: true, recursive: true }));

  async function failAttempt() {
    const claim = claims.claimNext();
    assert.ok(claim);
    await assert.rejects(
      () =>
        executeWaiverAdjudication(core, claim, {
          checkoutRoot,
          claimService: claims,
          evidenceService: {},
          ioPool,
          prepareCheckout: (/** @type {any} */ input) =>
            prepareReviewRunCheckout({
              ...input,
              spawnProcess: /** @type {any} */ (
                () => {
                  const child = Object.assign(new EventEmitter(), {
                    kill() {},
                    stderr: new PassThrough(),
                  });
                  queueMicrotask(() => {
                    child.stderr.end(
                      "fatal: unable to access repository: Could not resolve host: forge.example\n",
                    );
                    child.emit("close", 128, null);
                  });
                  return child;
                }
              ),
            }),
          resultService: {},
          runCodex: () => assert.fail("Codex launched after DNS failure"),
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "review_run_checkout_failed",
    );
  }

  await failAttempt();
  currentTime = 60_019;
  assert.equal(claims.claimNext(), undefined);
  currentTime = 60_020;
  await failAttempt();
  currentTime = 360_020;
  await failAttempt();
  assert.deepEqual(
    core.all(
      `SELECT attempt_number, error_code, exhausted
       FROM waiver_adjudication_pre_start_attempts
       ORDER BY attempt_number`,
    ),
    [
      {
        attempt_number: 1,
        error_code: "review_run_checkout_failed",
        exhausted: 0,
      },
      {
        attempt_number: 2,
        error_code: "review_run_checkout_failed",
        exhausted: 0,
      },
      {
        attempt_number: 3,
        error_code: "review_run_checkout_failed",
        exhausted: 1,
      },
    ],
  );
});
