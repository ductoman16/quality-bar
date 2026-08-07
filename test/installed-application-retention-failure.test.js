import assert from "node:assert/strict";
import { test } from "node:test";

import { createInstalledApplication } from "../src/installed-application.js";

function installation() {
  return {
    externalOrigin: "http://127.0.0.1:3000",
    freeSpaceReserveBytes: 5 * 1024 ** 3,
    masterKey: Buffer.alloc(32, 7),
    trustedProxyAddresses: [],
  };
}

test("a preflight failure retains the installation lock until the unavailable runtime closes", async () => {
  let released = 0;
  let closed = 0;
  const failure = Object.assign(new Error("preflight backup failed"), {
    code: "backup_failed",
  });
  const application = await createInstalledApplication({
    applicationVersion: "1.2.3",
    createRuntime: () =>
      /** @type {any} */ ({
        durableCore: null,
        async close() {
          closed += 1;
        },
      }),
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    prepareBackup: async () => {
      throw failure;
    },
    validateInstallation: () => ({
      releaseInstallationLock() {
        released += 1;
      },
    }),
    validateSources() {},
    writeLog() {},
  });

  assert.equal(released, 0);
  await application.close();
  assert.equal(closed, 1);
  assert.equal(released, 1);
});

test("a scheduled retention cleanup failure closes the runtime and surfaces exactly", async () => {
  const workers = new AbortController();
  const failure = new Error("retention cleanup failed");
  let backupRuns = 0;
  let cleanupRuns = 0;
  let closed = 0;
  /** @type {(() => void) | undefined} */
  let timerCallback;
  let timersSet = 0;
  /** @type {(failure: Error) => void} */
  let resolveSurfaced = () => {};
  /** @type {Promise<Error>} */
  const surfaced = new Promise((resolve) => {
    resolveSurfaced = (failure) => resolve(failure);
  });
  /** @type {any[]} */
  const logs = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      /** @type {any} */ ({
        cleanupEligibleData() {
          cleanupRuns += 1;
          throw failure;
        },
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }),
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    prepareBackup: async () => null,
    async runDailyBackup() {
      backupRuns += 1;
      return /** @type {any} */ ({ status: "created" });
    },
    setBackupTimer(callback) {
      timersSet += 1;
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
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
  /** @type {(() => void) | undefined} */
  let timerCallback;
  /** @type {(failure: Error) => void} */
  let resolveSurfaced = () => {};
  /** @type {Promise<Error & {code: string}>} */
  const surfaced = new Promise((resolve) => {
    resolveSurfaced = (failure) =>
      resolve(/** @type {Error & {code: string}} */ (failure));
  });
  /** @type {any[]} */
  const logs = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      /** @type {any} */ ({
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }),
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    prepareBackup: async () => null,
    runDailyBackup: async () => /** @type {any} */ ({ status: "created" }),
    setBackupTimer(callback) {
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
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
  /** @type {(() => void) | undefined} */
  let timerCallback;
  /** @type {(failure: Error) => void} */
  let resolveSurfaced = () => {};
  /** @type {Promise<Error & {code: string}>} */
  const surfaced = new Promise((resolve) => {
    resolveSurfaced = (failure) =>
      resolve(/** @type {Error & {code: string}} */ (failure));
  });
  /** @type {any[]} */
  const logs = [];

  await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime: () =>
      /** @type {any} */ ({
        cleanupEligibleData() {
          return Promise.reject("raw retention failure");
        },
        durableCore: {},
        async close() {
          closed += 1;
        },
        workerSignal: workers.signal,
      }),
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    prepareBackup: async () => null,
    runDailyBackup: async () => /** @type {any} */ ({ status: "created" }),
    setBackupTimer(callback) {
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
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
