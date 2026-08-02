import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  OwnedArtifactCleanupError,
  cleanupOwnedTemporaryArtifacts,
} from "../src/owned-artifact-cleanup.js";

import {
  StorageReserveError,
  createStorageReserveGate,
  requireStorageReservePause,
} from "../src/storage-reserve.js";

const GIB = 1024 ** 3;

test("runtime reserve facts remeasure both owned filesystems for every guarded action", () => {
  const available = new Map([
    ["/state", 8 * GIB],
    ["/checkouts", 7 * GIB],
  ]);
  /** @type {string[]} */
  const measured = [];
  const gate = createStorageReserveGate({
    checkoutsPath: "/checkouts",
    cleanupEligibleData() {},
    reserveBytes: 5 * GIB,
    statePath: "/state",
    statfs(path) {
      measured.push(path);
      const blocks = available.get(path);
      if (blocks === undefined) {
        throw new Error("unexpected filesystem");
      }
      return { bavail: blocks, bsize: 1 };
    },
  });

  assert.deepEqual(gate.assertWorkAdmissionAvailable(), {
    filesystems: [
      {
        available_bytes: 8 * GIB,
        filesystem: "state",
        path: "/state",
        status: "available",
      },
      {
        available_bytes: 7 * GIB,
        filesystem: "checkouts",
        path: "/checkouts",
        status: "available",
      },
    ],
    reserve_bytes: 5 * GIB,
    status: "available",
  });

  available.set("/checkouts", 4 * GIB);
  assert.throws(
    () => gate.assertCodexStartAvailable(),
    (error) => {
      assert.ok(error instanceof StorageReserveError);
      assert.equal(error.code, "storage_reserve_unavailable");
      assert.equal(/** @type {any} */ (error).action, "codex_start");
      assert.deepEqual(/** @type {any} */ (error).facts, {
        filesystems: [
          {
            available_bytes: 8 * GIB,
            filesystem: "state",
            path: "/state",
            status: "available",
          },
          {
            available_bytes: 4 * GIB,
            filesystem: "checkouts",
            path: "/checkouts",
            status: "unavailable",
          },
        ],
        reserve_bytes: 5 * GIB,
        status: "unavailable",
      });
      return true;
    },
  );
  assert.deepEqual(measured, [
    "/state",
    "/checkouts",
    "/state",
    "/checkouts",
    "/state",
    "/checkouts",
  ]);
});

test("a failed runtime measurement owns an exact filesystem error without inferred health", () => {
  const gate = createStorageReserveGate({
    checkoutsPath: "/checkouts",
    cleanupEligibleData() {},
    reserveBytes: 5 * GIB,
    statePath: "/state",
    statfs(path) {
      if (path === "/state") {
        return { bavail: 6 * GIB, bsize: 1 };
      }
      throw new Error("measurement failed");
    },
  });

  assert.throws(
    () => gate.assertPollingObservationAdvanceAvailable(),
    (error) => {
      assert.ok(error instanceof StorageReserveError);
      assert.equal(error.code, "storage_reserve_check_failed");
      assert.equal(
        /** @type {any} */ (error).action,
        "polling_observation_advancement",
      );
      assert.equal(/** @type {any} */ (error).filesystem, "checkouts");
      assert.equal(/** @type {any} */ (error).path, "/checkouts");
      assert.equal("facts" in error, false);
      return true;
    },
  );
});

test("runtime reserve removes eligible data and remeasures before blocking", () => {
  let availableBytes = 4 * GIB;
  let cleanupCalls = 0;
  const gate = createStorageReserveGate({
    checkoutsPath: "/checkouts",
    cleanupEligibleData() {
      cleanupCalls += 1;
      availableBytes = 6 * GIB;
    },
    reserveBytes: 5 * GIB,
    statePath: "/state",
    statfs: () => ({ bavail: availableBytes, bsize: 1 }),
  });

  assert.equal(gate.assertWorkAdmissionAvailable().status, "available");
  assert.equal(cleanupCalls, 1);
});

test("storage reserve reports owned cleanup outcome and exact cleanup failure", () => {
  const gate = createStorageReserveGate({
    cleanupEligibleData: () => ({
      artifacts: { removed: 3 },
      sessions: { changes: 2 },
    }),
    now: () => 1_000,
    statfs: () => ({ bavail: 8 * GIB, bsize: 1 }),
  });
  gate.cleanupEligibleData();
  assert.deepEqual(gate.readCleanupFacts(), {
    artifacts_removed: 3,
    error: null,
    last_run_at: "1970-01-01T00:00:01.000Z",
    sessions_removed: 2,
    status: "available",
  });

  const failure = Object.assign(new Error("Owned cleanup failed."), {
    code: "owned_artifact_cleanup_remove_failed",
  });
  const failedGate = createStorageReserveGate({
    cleanupEligibleData: () => {
      throw failure;
    },
    now: () => 1_000,
    statfs: () => ({ bavail: 8 * GIB, bsize: 1 }),
  });
  assert.throws(
    () => failedGate.cleanupEligibleData(),
    (error) => error === failure,
  );
  assert.deepEqual(failedGate.readCleanupFacts(), {
    artifacts_removed: null,
    error: {
      code: "owned_artifact_cleanup_remove_failed",
      detail: "Owned cleanup failed.",
    },
    last_run_at: "1970-01-01T00:00:01.000Z",
    sessions_removed: null,
    status: "unavailable",
  });
});

test("scheduled Forgejo polling pauses low reserve and fails fast on measurement errors", () => {
  assert.doesNotThrow(() =>
    requireStorageReservePause(
      new StorageReserveError(
        "storage_reserve_unavailable",
        "A required runtime filesystem is below the free-space reserve",
        {},
      ),
    ),
  );
  const measurementFailure = new StorageReserveError(
    "storage_reserve_check_failed",
    "The state filesystem free-space reserve could not be measured",
    {},
  );
  assert.throws(
    () => requireStorageReservePause(measurementFailure),
    (error) => error === measurementFailure,
  );
});

/** @param {import("node:test").TestContext} context */
function temporaryRoot(context) {
  const root = join(
    tmpdir(),
    `quality-bar-owned-artifact-cleanup-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  context.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

/** @param {Record<string, unknown>[]} rows */
function cleanupDurableCore(rows) {
  return { all: () => rows };
}

test("owned cleanup removes only absent, terminal, and superseded checkout artifacts", (context) => {
  const root = temporaryRoot(context);
  for (const path of [
    join(root, "absent-work", "1", "checkout"),
    join(root, "terminal-work", "1", "checkout"),
    join(root, "running-work", "1", "checkout"),
    join(root, "running-work", "2", "checkout"),
  ]) {
    mkdirSync(path, { recursive: true });
  }

  cleanupOwnedTemporaryArtifacts({
    checkoutRoot: root,
    durableCore: cleanupDurableCore([
      {
        execution_status: "completed",
        fencing_token: 1,
        work_id: "terminal-work",
      },
      {
        execution_status: "running",
        fencing_token: 2,
        work_id: "running-work",
      },
    ]),
  });

  assert.equal(existsSync(join(root, "absent-work")), false);
  assert.equal(existsSync(join(root, "terminal-work")), false);
  assert.equal(existsSync(join(root, "running-work", "1")), false);
  assert.equal(existsSync(join(root, "running-work", "2", "checkout")), true);
});

test("owned cleanup preserves the exact failure owner", () => {
  const failure = Object.assign(new Error("SQLite unavailable"), {
    code: "SQLITE_IOERR",
  });

  assert.throws(
    () =>
      cleanupOwnedTemporaryArtifacts({
        checkoutRoot: "/quality-bar-checkouts",
        durableCore: {
          all: () => {
            throw failure;
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof OwnedArtifactCleanupError);
      assert.equal(error.code, "owned_artifact_cleanup_owner_read_failed");
      assert.equal(
        error.message,
        "Owned temporary artifact owners could not be read",
      );
      assert.equal(error.cause, failure);
      return true;
    },
  );
});
