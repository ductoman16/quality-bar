import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createApplication } from "../src/application.js";
import { createCodexExecutionWorker } from "../src/codex-execution-worker.js";
import { createCodexExecutionConcurrencyService } from "../src/codex-execution-concurrency.js";
import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewService } from "../src/review.js";
import {
  CODEX_EXECUTION_DEADLINE_MS,
  PERFORMANCE_EXECUTION_PROFILE,
  PERFORMANCE_PROFILE,
  PERFORMANCE_SAMPLE_COUNT,
  createPerformanceFacts,
} from "../scripts/verification/performance-budget.mjs";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

const APPLICATION_VERSION = "1.2.3";
const OPERATOR_ORIGIN = "http://127.0.0.1:3000";
const PERFORMANCE_FIXTURE_TIMESTAMP = 1_700_000_000_000;

/** @param {number} startedAt */
function elapsedMilliseconds(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function validInstallation() {
  return {
    externalOrigin: OPERATOR_ORIGIN,
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

/** @param {string} databasePath @param {string} backupsPath */
function createReadinessApplication(databasePath, backupsPath) {
  return createApplication({
    applicationVersion: APPLICATION_VERSION,
    backupsPath,
    databasePath,
    createCodexRuntime: () => ({
      async close() {},
      start() {},
    }),
    createStorageReserve: () => availableStorageReserve,
    loadInstallation: validInstallation,
    validateCodexAuthentication() {},
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    validateTools() {},
    now: () => PERFORMANCE_FIXTURE_TIMESTAMP,
    writeLog() {},
  });
}

/** @param {ReturnType<typeof createApplication>} application */
async function listen(application) {
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = application.server.address();
  if (!address || typeof address === "string") {
    throw new Error("performance_fixture_server_address_unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function measureReadiness() {
  const samples = [];
  for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
    const directory = mkdtempSync(
      join(tmpdir(), "quality-bar-performance-ready-"),
    );
    const databasePath = join(directory, "quality-bar.sqlite3");
    const backupsPath = join(directory, "backups");
    let application;
    try {
      const prepared = openDurableCore(databasePath);
      prepared.close();
      const startedAt = performance.now();
      application = createReadinessApplication(databasePath, backupsPath);
      const origin = await listen(application);
      const response = await fetch(`${origin}/health/ready`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ready" });
      samples.push(elapsedMilliseconds(startedAt));
    } finally {
      await application?.close();
      rmSync(directory, { force: true, recursive: true });
    }
  }
  return samples;
}

/** @param {number | string} index */
function reviewDefinition(index) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "advisory",
        instruction: "Preserve local performance fixture boundaries.",
      },
    ],
    description: "Measure an accepted local Review mutation.",
    name: `Performance fixture Review ${index}`,
  };
}

async function measureLocalApi() {
  let nextReviewId = 0;
  const { origin, request } = await startApplication({
    createReviews: (durableCore, options) =>
      createReviewService(durableCore, {
        ...options,
        createId: () => `performance-review-id-${++nextReviewId}`,
      }),
    now: () => PERFORMANCE_FIXTURE_TIMESTAMP,
  });
  const headers = await authenticatedOperatorHeaders(request);
  const seedResponse = await fetch(`${origin}/api/v1/reviews`, {
    body: JSON.stringify(reviewDefinition("seed")),
    headers,
    method: "POST",
  });
  assert.equal(seedResponse.status, 201);
  await seedResponse.json();

  const readSamples = [];
  for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${origin}/api/v1/reviews`, {
      headers: { cookie: headers.cookie },
    });
    assert.equal(response.status, 200);
    const body = /** @type {{reviews: unknown[]}} */ (await response.json());
    assert.equal(body.reviews.length, 1);
    readSamples.push(elapsedMilliseconds(startedAt));
  }

  const acceptedMutationSamples = [];
  for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${origin}/api/v1/reviews`, {
      body: JSON.stringify(reviewDefinition(index)),
      headers,
      method: "POST",
    });
    assert.equal(response.status, 201);
    const body =
      /** @type {{name: string, active_version: {number: number}}} */ (
        await response.json()
      );
    assert.equal(body.name, reviewDefinition(index).name);
    assert.equal(body.active_version.number, 1);
    acceptedMutationSamples.push(elapsedMilliseconds(startedAt));
  }
  return { acceptedMutationSamples, readSamples };
}

async function measureReadyQueueClaim() {
  const samples = [];
  for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
    const directory = mkdtempSync(
      join(tmpdir(), "quality-bar-performance-claim-"),
    );
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    try {
      await createQueuedReviewRun(core);
      const concurrency = createCodexExecutionConcurrencyService(core);
      assert.equal(concurrency.set(1), 1);
      const service = createReviewRunClaimService(core, {
        createWorkerId: () => `performance-worker-${index}`,
        now: () => 1_000,
      });
      const startedAt = performance.now();
      /** @type {{callback: () => void, delay: number, id: number}[]} */
      const scheduledTimers = [];
      let nextTimerId = 0;
      /** @type {{claim: import("../src/codex-execution-claim.js").CodexExecutionClaim, durationMs: number} | undefined} */
      let claimed;
      let releaseExecution = () => {};
      const executionHold = new Promise((resolve) => {
        releaseExecution = () => resolve(undefined);
      });
      let claimFailure;
      const worker = createCodexExecutionWorker({
        claimService: service,
        executeClaim: (claim) => {
          claimed = { claim, durationMs: elapsedMilliseconds(startedAt) };
          return executionHold;
        },
        reportFailure: (error) => {
          claimFailure = error;
        },
        clearTimer: (timer) => {
          const timerIndex = scheduledTimers.findIndex(
            (scheduled) => scheduled.id === timer,
          );
          if (timerIndex >= 0) {
            scheduledTimers.splice(timerIndex, 1);
          }
        },
        setTimer: (callback, delay) => {
          const id = ++nextTimerId;
          scheduledTimers.push({ callback, delay, id });
          return id;
        },
      });
      try {
        worker.start();
        const initialTimer = scheduledTimers.shift();
        assert.ok(initialTimer);
        assert.equal(initialTimer.delay, 0);
        initialTimer.callback();
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(claimFailure, undefined);
        assert.ok(claimed, "performance_fixture_queue_claim_not_started");
        assert.equal(claimed.claim?.workId, "review-run-1");
        assert.equal(claimed.claim?.workKind, "review_run");
        samples.push(claimed.durationMs);
      } finally {
        releaseExecution();
        await worker.close();
      }
    } finally {
      core.close();
      rmSync(directory, { force: true, recursive: true });
    }
  }
  return samples;
}

test("controlled personal-v1 performance fixtures hard-fail budget regressions", async () => {
  assert.deepEqual(
    PERFORMANCE_EXECUTION_PROFILE,
    PERFORMANCE_PROFILE,
    "performance_execution_profile_unsupported",
  );
  const durations = await measureLocalApi();
  const facts = createPerformanceFacts({
    durationsMs: {
      readiness: await measureReadiness(),
      local_read: durations.readSamples,
      accepted_local_mutation: durations.acceptedMutationSamples,
      ready_queue_claim: await measureReadyQueueClaim(),
    },
    executionProfile: PERFORMANCE_EXECUTION_PROFILE,
  });
  assert.equal(facts.codex_execution_deadline_ms, CODEX_EXECUTION_DEADLINE_MS);
  process.stdout.write(
    `QUALITY_BAR_PERFORMANCE_FACTS ${JSON.stringify(facts)}\n`,
  );
  assert.equal(
    facts.outcome,
    "pass",
    `performance_budget_exceeded: ${JSON.stringify(facts)}`,
  );
});
