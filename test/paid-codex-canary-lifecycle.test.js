import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePaidCodexCanaryEvidence } from "../scripts/verification/paid-codex-canary-invocation.mjs";
import { runPaidCodexCanaryLifecycle } from "../scripts/verification/paid-codex-canary-runner.mjs";
import {
  paidCodexPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

const sourceCommit = releaseCanarySourceCommit;

function manifestWithPriorPass() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    releaseCanaries: { paidCodex: paidCodexPass() },
    sourceCommit,
    verification: { kind: "cost-free" },
  };
}

/** @param {string} path @param {(assertOwned: () => void, trackProcessGroup: (processGroupId: number) => void) => Promise<any>} operation */
async function successfulLease(path, operation) {
  assert.equal(path, "/paid.lock");
  return operation(
    () => {},
    () => {},
  );
}

test("a paid attempt durably invalidates prior PASS evidence before provider launch", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  let providerLaunches = 0;
  /** @type {any} */ let standalone = null;
  const evidence = await runPaidCodexCanaryLifecycle({
    applicationVersion: () => "1.2.3",
    canaryPath: "/paid.json",
    invoke: async () => {
      providerLaunches += 1;
      assert.equal(manifest.releaseCanaries.paidCodex.outcome, "fail");
      assert.equal(
        manifest.releaseCanaries.paidCodex.failure.code,
        "paid_codex_canary_attempt_started",
      );
      return paidCodexPass();
    },
    lockPath: "/paid.lock",
    manifestPath: "/manifest.json",
    mergeEvidence: mergePaidCodexCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish({ canary, mergeEvidence }) {
      standalone = canary;
      manifest = mergeEvidence(manifest, canary);
    },
    requireCostFreeEvidence() {},
    sourceCommit,
    sourceStatus: "",
    withLease: successfulLease,
  });

  assert.equal(providerLaunches, 1);
  assert.equal(evidence.outcome, "pass");
  assert.equal(standalone?.outcome, "pass");
  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "pass");
});

test("attempt setup failure replaces prior canonical PASS before launch", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  let providerLaunches = 0;
  const evidence = await runPaidCodexCanaryLifecycle({
    applicationVersion() {
      throw Object.assign(new Error("application version unavailable"), {
        code: "paid_codex_canary_application_version_unavailable",
      });
    },
    canaryPath: "/paid.json",
    invoke: async () => {
      providerLaunches += 1;
      return paidCodexPass();
    },
    lockPath: "/paid.lock",
    manifestPath: "/manifest.json",
    mergeEvidence: mergePaidCodexCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish({ canary, mergeEvidence }) {
      manifest = mergeEvidence(manifest, canary);
    },
    requireCostFreeEvidence() {},
    sourceCommit,
    sourceStatus: "",
    withLease: successfulLease,
  });

  assert.equal(providerLaunches, 0);
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure.code,
    "paid_codex_canary_application_version_unavailable",
  );
  assert.deepEqual(manifest.releaseCanaries.paidCodex, evidence);
});

test("failed final publication leaves the canonical paid attempt non-PASS", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  await assert.rejects(
    () =>
      runPaidCodexCanaryLifecycle({
        applicationVersion: () => "1.2.3",
        canaryPath: "/paid.json",
        invoke: async () => paidCodexPass(),
        lockPath: "/paid.lock",
        manifestPath: "/manifest.json",
        mergeEvidence: mergePaidCodexCanaryEvidence,
        now: () => 1_700_000_000_000,
        publish({ canary, mergeEvidence }) {
          if (canary.outcome === "pass") {
            throw Object.assign(new Error("canonical unavailable"), {
              code: "paid_codex_canary_publication_failed",
            });
          }
          manifest = mergeEvidence(manifest, canary);
        },
        requireCostFreeEvidence() {},
        sourceCommit,
        sourceStatus: "",
        withLease: successfulLease,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "paid_codex_canary_publication_failed",
  );

  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "fail");
  assert.equal(
    manifest.releaseCanaries.paidCodex.failure.code,
    "paid_codex_canary_attempt_started",
  );
});

test("lease cleanup loss after provider completion replaces the attempt with failure", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  const evidence = await runPaidCodexCanaryLifecycle({
    applicationVersion: () => "1.2.3",
    canaryPath: "/paid.json",
    invoke: async () => paidCodexPass(),
    lockPath: "/paid.lock",
    manifestPath: "/manifest.json",
    mergeEvidence: mergePaidCodexCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish({ canary, mergeEvidence }) {
      manifest = mergeEvidence(manifest, canary);
    },
    requireCostFreeEvidence() {},
    sourceCommit,
    sourceStatus: "",
    withLease: async (path, operation) => {
      assert.equal(path, "/paid.lock");
      await operation(
        () => {},
        () => {},
      );
      throw Object.assign(new Error("paid lease cleanup failed"), {
        code: "paid_codex_canary_lock_lost",
      });
    },
  });

  assert.equal(evidence.outcome, "fail");
  assert.equal(
    manifest.releaseCanaries.paidCodex.failure.code,
    "paid_codex_canary_lock_lost",
  );
});

test("failed pre-spend invalidation aborts the provider launch", async () => {
  let providerLaunches = 0;
  await assert.rejects(
    () =>
      runPaidCodexCanaryLifecycle({
        applicationVersion: () => "1.2.3",
        canaryPath: "/paid.json",
        invoke: async () => {
          providerLaunches += 1;
          return paidCodexPass();
        },
        lockPath: "/paid.lock",
        manifestPath: "/manifest.json",
        mergeEvidence: mergePaidCodexCanaryEvidence,
        now: () => 1_700_000_000_000,
        publish() {
          throw Object.assign(new Error("manifest unavailable"), {
            code: "release_canary_manifest_lock_unavailable",
          });
        },
        requireCostFreeEvidence() {},
        sourceCommit,
        sourceStatus: "",
        withLease: successfulLease,
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "release_canary_manifest_lock_unavailable",
  );

  assert.equal(providerLaunches, 0);
});

test("a unique attempt identifier prevents an older run from publishing over a later live attempt", async () => {
  /** @type {any} */ let manifest = manifestWithPriorPass();
  /** @type {(value: any) => void} */ let finishSecondProvider = () => {};
  const secondProvider = new Promise((resolve) => {
    finishSecondProvider = resolve;
  });
  /** @type {(value?: void) => void} */ let signalSecondStarted = () => {};
  const secondStarted = new Promise((resolve) => {
    signalSecondStarted = resolve;
  });
  let markerPublications = 0;
  /** @type {Promise<any> | null} */ let secondLifecycle = null;
  /** @param {{canary: any, mergeEvidence: (manifest: any, canary: any) => any}} input */
  const publish = ({ canary, mergeEvidence }) => {
    manifest = mergeEvidence(manifest, canary);
    if (canary.failure?.code === "paid_codex_canary_attempt_started") {
      markerPublications += 1;
      if (markerPublications === 2) {
        signalSecondStarted();
      }
    }
  };
  const common = {
    applicationVersion: () => "1.2.3",
    canaryPath: "/paid.json",
    lockPath: "/paid.lock",
    manifestPath: "/manifest.json",
    mergeEvidence: mergePaidCodexCanaryEvidence,
    now: () => 1_700_000_000_000,
    publish,
    requireCostFreeEvidence() {},
    sourceCommit,
    sourceStatus: "",
  };

  await assert.rejects(
    () =>
      runPaidCodexCanaryLifecycle({
        ...common,
        createAttemptId: () => "00000000-0000-4000-8000-000000000001",
        invoke: async () => paidCodexPass(),
        withLease: async (path, operation) => {
          const result = await successfulLease(path, operation);
          secondLifecycle = runPaidCodexCanaryLifecycle({
            ...common,
            createAttemptId: () => "00000000-0000-4000-8000-000000000002",
            invoke: async () => secondProvider,
            withLease: successfulLease,
          });
          await secondStarted;
          return result;
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "paid_codex_canary_attempt_superseded",
  );
  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "fail");
  assert.equal(
    manifest.releaseCanaries.paidCodex.failure.attemptId,
    "00000000-0000-4000-8000-000000000002",
  );

  finishSecondProvider(paidCodexPass());
  const secondEvidence = await /** @type {Promise<any>} */ (
    /** @type {unknown} */ (secondLifecycle)
  );
  assert.equal(secondEvidence.outcome, "pass");
  assert.equal(manifest.releaseCanaries.paidCodex.outcome, "pass");
});

test("a lease-rejected invocation never writes canonical evidence", async () => {
  let providerLaunches = 0;
  let publications = 0;
  await assert.rejects(
    () =>
      runPaidCodexCanaryLifecycle({
        applicationVersion: () => "1.2.3",
        canaryPath: "/paid.json",
        invoke: async () => {
          providerLaunches += 1;
          return paidCodexPass();
        },
        lockPath: "/paid.lock",
        manifestPath: "/manifest.json",
        mergeEvidence: mergePaidCodexCanaryEvidence,
        publish() {
          publications += 1;
        },
        requireCostFreeEvidence() {},
        sourceCommit,
        sourceStatus: "",
        withLease: async () => {
          throw Object.assign(new Error("paid canary already running"), {
            code: "paid_codex_canary_lock_unavailable",
          });
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "paid_codex_canary_lock_unavailable",
  );
  assert.equal(providerLaunches, 0);
  assert.equal(publications, 0);
});
