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

/** @param {() => void} callback */
function nextTurn(callback) {
  return new Promise((resolve) => {
    setImmediate(() => {
      callback();
      resolve(undefined);
    });
  });
}

test("pre-migration finalization precedes the initial daily backup and next check", async () => {
  const workers = new AbortController();
  /** @type {string[]} */
  const events = [];
  /** @type {Array<() => void>} */
  const timerCallbacks = [];
  const runtime = /** @type {any} */ ({
    durableCore: {},
    async close() {
      events.push("close");
    },
    workerSignal: workers.signal,
  });

  const application = await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    clearBackupTimer() {
      events.push("clear-timer");
    },
    createRuntime() {
      events.push("create-runtime");
      return runtime;
    },
    databasePath: "/quality-bar.sqlite3",
    finalizeBackup() {
      events.push("finalize");
      return [];
    },
    loadInstallation() {
      events.push("load-installation");
      return installation();
    },
    now: () => Date.parse("2026-07-28T01:02:03Z"),
    async prepareBackup() {
      events.push("prepare");
      return /** @type {any} */ ({ kind: "pre-migration" });
    },
    async runDailyBackup() {
      events.push("daily");
      return /** @type {any} */ ({ status: "created" });
    },
    setBackupTimer(callback) {
      events.push("set-timer");
      timerCallbacks.push(callback);
      return /** @type {any} */ ({
        unref() {
          events.push("unref-timer");
        },
      });
    },
    validateInstallation(options) {
      events.push("validate-installation");
      assert.deepEqual(options, { reserveBytes: 5 * 1024 ** 3 });
      return { releaseInstallationLock() {} };
    },
    validateSources() {
      events.push("validate-sources");
    },
    writeLog() {},
  });

  assert.deepEqual(events, [
    "validate-sources",
    "load-installation",
    "validate-installation",
    "prepare",
    "create-runtime",
    "finalize",
    "daily",
    "set-timer",
    "unref-timer",
  ]);

  timerCallbacks[0]();
  await nextTurn(() => {});
  assert.deepEqual(events.slice(-3), ["daily", "set-timer", "unref-timer"]);

  await application.close();
  assert.deepEqual(events.slice(-2), ["clear-timer", "close"]);
});

test("an initial daily backup failure closes the runtime and surfaces exactly", async () => {
  const failure = Object.assign(new Error("disk write failed"), {
    code: "SQLITE_IOERR_WRITE",
  });
  /** @type {Array<Record<string, string>>} */
  const logs = [];
  let closed = false;
  let timerSet = false;

  await assert.rejects(
    createInstalledApplication({
      applicationVersion: "1.2.3",
      backupsPath: "/backups",
      createRuntime: () =>
        /** @type {any} */ ({
          durableCore: {},
          async close() {
            closed = true;
          },
        }),
      databasePath: "/quality-bar.sqlite3",
      loadInstallation: installation,
      prepareBackup: async () => null,
      async runDailyBackup() {
        throw failure;
      },
      setBackupTimer() {
        timerSet = true;
        return /** @type {any} */ ({ unref() {} });
      },
      validateInstallation: () => ({ releaseInstallationLock() {} }),
      validateSources() {},
      writeLog(line) {
        logs.push(JSON.parse(line));
      },
    }),
    failure,
  );

  assert.equal(closed, true);
  assert.equal(timerSet, false);
  assert.equal(logs[0].error, "SQLITE_IOERR_WRITE");
  assert.equal(logs[0].detail, "disk write failed");
});

test("hard storage shutdown cancels the installed daily-backup worker until restart", async () => {
  const workers = new AbortController();
  let backupRuns = 0;
  let cleared = 0;
  let closed = 0;
  /** @type {(() => void) | undefined} */
  let timerCallback;
  const application = await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    clearBackupTimer() {
      cleared += 1;
    },
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
    async runDailyBackup() {
      backupRuns += 1;
      return /** @type {any} */ ({ status: "created" });
    },
    setBackupTimer(callback) {
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
    },
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog() {},
  });

  assert.equal(backupRuns, 1);
  workers.abort(
    Object.assign(new Error("SQLite durable write failed"), {
      code: "storage_unavailable",
    }),
  );
  assert.equal(cleared, 1);
  timerCallback?.();
  await nextTurn(() => {});
  assert.equal(backupRuns, 1);

  await application.close();
  assert.equal(cleared, 1);
  assert.equal(closed, 1);
});

test("hard storage shutdown aborts an active installed daily backup", async () => {
  const workers = new AbortController();
  let backupRuns = 0;
  let backupStops = 0;
  let closed = 0;
  let surfaced = 0;
  /** @type {(() => void) | undefined} */
  let timerCallback;
  const application = await createInstalledApplication({
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
    async runDailyBackup(input) {
      backupRuns += 1;
      if (backupRuns === 1) {
        return /** @type {any} */ ({ status: "current" });
      }
      assert.ok(input.signal);
      const signal = input.signal;
      const stopped = Promise.withResolvers();
      signal.addEventListener(
        "abort",
        () => {
          backupStops += 1;
          stopped.reject(signal.reason);
        },
        { once: true },
      );
      return stopped.promise;
    },
    setBackupTimer(callback) {
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
    },
    surfaceBackupFailure() {
      surfaced += 1;
    },
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog() {},
  });

  timerCallback?.();
  await nextTurn(() => {});
  workers.abort(
    Object.assign(new Error("SQLite durable write failed"), {
      code: "storage_unavailable",
    }),
  );
  await nextTurn(() => {});

  assert.equal(backupRuns, 2);
  assert.equal(backupStops, 1);
  assert.equal(surfaced, 0);
  assert.equal(closed, 0);

  await application.close();
  assert.equal(closed, 1);
});

test("hard storage shutdown does not hide a different concurrent backup failure", async () => {
  const workers = new AbortController();
  const backup = Promise.withResolvers();
  /** @type {any[]} */
  const logs = [];
  let backupRuns = 0;
  let closed = 0;
  let surfaced;
  /** @type {(() => void) | undefined} */
  let timerCallback;
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
    async runDailyBackup() {
      backupRuns += 1;
      return backupRuns === 1
        ? /** @type {any} */ ({ status: "current" })
        : backup.promise;
    },
    setBackupTimer(callback) {
      timerCallback = callback;
      return /** @type {any} */ ({ unref() {} });
    },
    surfaceBackupFailure(failure) {
      surfaced = failure;
    },
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
    writeLog(line) {
      logs.push(JSON.parse(line));
    },
  });
  timerCallback?.();
  await nextTurn(() => {});
  workers.abort(
    Object.assign(new Error("SQLite durable write failed"), {
      code: "storage_unavailable",
    }),
  );
  const failure = Object.assign(new Error("backup cleanup failed"), {
    code: "backup_cleanup_failed",
  });

  backup.reject(failure);
  await nextTurn(() => {});
  await nextTurn(() => {});

  assert.equal(closed, 1);
  assert.equal(surfaced, failure);
  assert.equal(logs[0].error, "backup_cleanup_failed");
  assert.equal(logs[0].detail, "backup cleanup failed");
});

test("a scheduled backup failure closes the runtime and surfaces exactly", async () => {
  const workers = new AbortController();
  const failure = Object.assign(new Error("daily backup failed"), {
    code: "SQLITE_FULL",
  });
  let backupRuns = 0;
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
    async runDailyBackup() {
      backupRuns += 1;
      if (backupRuns === 2) {
        throw failure;
      }
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
    writeLog() {},
  });

  assert.equal(backupRuns, 1);
  assert.equal(timersSet, 1);
  if (!timerCallback) {
    throw new Error("backup timer was not scheduled");
  }
  timerCallback();
  assert.equal(await surfaced, failure);
  assert.equal(backupRuns, 2);
  assert.equal(closed, 1);
  assert.equal(timersSet, 1);
});
