import assert from "node:assert/strict";
import { test } from "node:test";

import {
  StorageReserveError,
  createStorageReserveGate,
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
  assert.deepEqual(measured, ["/state", "/checkouts", "/state", "/checkouts"]);
});

test("a failed runtime measurement owns an exact filesystem error without inferred health", () => {
  const gate = createStorageReserveGate({
    checkoutsPath: "/checkouts",
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
