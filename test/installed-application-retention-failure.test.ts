import assert from "node:assert/strict";
import { test } from "node:test";

import { createInstalledApplication } from "../src/installed-application.ts";

function installation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

test("a scheduled retention cleanup failure closes the runtime and surfaces exactly", async () => {
  const workers = new AbortController();
  const failure = new Error("retention cleanup failed");
  let backupRuns = 0;
  let cleanupRuns = 0;
  let closed = 0;
  let timerCallback: (() => void) | undefined;
  let timersSet = 0;
  let resolveSurfaced: (failure: Error) => void = () => {};
  const surfaced: Promise<Error> = new Promise((resolve) => {
    resolveSurfaced = (failure) => resolve(failure);
  });
  const logs: any[] = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      ({
        cleanupEligibleData() {
          cleanupRuns += 1;
          throw failure;
        },
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }) as any,
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    async runDailyBackup() {
      backupRuns += 1;
      return { status: "created" } as any;
    },
    setBackupTimer(callback) {
      timersSet += 1;
      timerCallback = callback;
      return { unref() {} } as any;
    },
    surfaceBackupFailure: resolveSurfaced,
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog(line) {
      logs.push(JSON.parse(line));
    },
  });

  assert.equal(backupRuns, 1);
  assert.equal(timersSet, 1);
  if (!timerCallback) {
    throw new Error("backup timer was not scheduled");
  }
  timerCallback();
  assert.equal(await surfaced, failure);
  assert.equal(backupRuns, 2);
  assert.equal(cleanupRuns, 1);
  assert.equal(closed, 1);
  assert.equal(timersSet, 1);
  assert.equal(logs[0].event, "retention_cleanup_failed");
  assert.equal(logs[0].error, "retention_cleanup_failed");
  assert.equal(logs[0].detail, "retention cleanup failed");
});

test("a scheduled retention cleanup without a runtime capability fails closed", async () => {
  const workers = new AbortController();
  let closed = 0;
  let timerCallback: (() => void) | undefined;
  let resolveSurfaced: (failure: Error) => void = () => {};
  const surfaced: Promise<Error & { code: string }> = new Promise((resolve) => {
    resolveSurfaced = (failure) => resolve(failure as Error & { code: string });
  });
  const logs: any[] = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      ({
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }) as any,
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    runDailyBackup: async () => ({ status: "created" }) as any,
    setBackupTimer(callback) {
      timerCallback = callback;
      return { unref() {} } as any;
    },
    surfaceBackupFailure: resolveSurfaced,
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog(line) {
      logs.push(JSON.parse(line));
    },
  });

  if (!timerCallback) {
    throw new Error("backup timer was not scheduled");
  }
  timerCallback();
  const surfacedFailure = await surfaced;
  assert.equal(surfacedFailure.code, "retention_cleanup_unavailable");
  assert.equal(
    surfacedFailure.message,
    "Retention cleanup capability is unavailable",
  );
  assert.equal(closed, 1);
  assert.equal(logs[0].error, "retention_cleanup_unavailable");
});

test("a non-error scheduled retention rejection is normalized and surfaced", async () => {
  const workers = new AbortController();
  let closed = 0;
  let timerCallback: (() => void) | undefined;
  let resolveSurfaced: (failure: Error) => void = () => {};
  const surfaced: Promise<Error & { code: string }> = new Promise((resolve) => {
    resolveSurfaced = (failure) => resolve(failure as Error & { code: string });
  });
  const logs: any[] = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      ({
        cleanupEligibleData() {
          return Promise.reject("raw retention failure");
        },
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }) as any,
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    runDailyBackup: async () => ({ status: "created" }) as any,
    setBackupTimer(callback) {
      timerCallback = callback;
      return { unref() {} } as any;
    },
    surfaceBackupFailure: resolveSurfaced,
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog(line) {
      logs.push(JSON.parse(line));
    },
  });

  if (!timerCallback) {
    throw new Error("backup timer was not scheduled");
  }
  timerCallback();
  const failure = await surfaced;
  assert.equal(failure.code, "retention_cleanup_failed");
  assert.equal(failure.message, "Maintenance failure is not an Error");
  assert.equal(closed, 1);
  assert.equal(logs[0].event, "retention_cleanup_failed");
  assert.equal(logs[0].error, "retention_cleanup_failed");
});
