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

function nextTurn(callback: () => void) {
  return new Promise((resolve) => {
    setImmediate(() => {
      callback();
      resolve(undefined);
    });
  });
}

test("initial daily backup precedes the scheduled backup and cleanup", async () => {
  const workers = new AbortController();
  const events: string[] = [];
  const timerCallbacks: Array<() => void> = [];
  const application = await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    createRuntime() {
      events.push("create-runtime");
      return {
        durableCore: {},
        cleanupEligibleData() {
          events.push("cleanup");
        },
        async close() {},
        workerSignal: workers.signal,
      } as any;
    },
    databasePath: "/quality-bar.sqlite3",
    loadInstallation: installation,
    async runDailyBackup() {
      events.push("daily");
      return { status: "created" };
    },
    setBackupTimer(callback) {
      events.push("set-timer");
      timerCallbacks.push(callback);
      return { unref() {} } as any;
    },
    validateInstallation: () => ({ releaseInstallationLock() {} }),
    validateSources() {},
  });

  assert.deepEqual(events, ["create-runtime", "daily", "set-timer"]);
  timerCallbacks[0]();
  await nextTurn(() => {});
  assert.deepEqual(events.slice(-3), ["daily", "cleanup", "set-timer"]);
  await application.close();
});

test("an initial daily backup failure closes the runtime and surfaces exactly", async () => {
  const failure = Object.assign(new Error("disk write failed"), {
    code: "SQLITE_IOERR_WRITE",
  });
  const logs: Array<Record<string, string>> = [];
  let closed = false;
  let timerSet = false;

  await assert.rejects(
    createInstalledApplication({
      applicationVersion: "1.2.3",
      backupsPath: "/backups",
      createRuntime: () =>
        ({
          durableCore: {},
          async close() {
            closed = true;
          },
        }) as any,
      databasePath: "/quality-bar.sqlite3",
      loadInstallation: installation,
      async runDailyBackup() {
        throw failure;
      },
      setBackupTimer() {
        timerSet = true;
        return { unref() {} } as any;
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
  let timerCallback: (() => void) | undefined;
  const application = await createInstalledApplication({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    clearBackupTimer() {
      cleared += 1;
    },
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
    async runDailyBackup() {
      backupRuns += 1;
      return { status: "created" } as any;
    },
    setBackupTimer(callback) {
      timerCallback = callback;
      return { unref() {} } as any;
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
  let timerCallback: (() => void) | undefined;
  const application = await createInstalledApplication({
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
    async runDailyBackup(input) {
      backupRuns += 1;
      if (backupRuns === 1) {
        return { status: "current" } as any;
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
      return { unref() {} } as any;
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
  const logs: any[] = [];
  let backupRuns = 0;
  let closed = 0;
  let surfaced;
  let timerCallback: (() => void) | undefined;
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
    async runDailyBackup() {
      backupRuns += 1;
      return backupRuns === 1 ? ({ status: "current" } as any) : backup.promise;
    },
    setBackupTimer(callback) {
      timerCallback = callback;
      return { unref() {} } as any;
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
  let timerCallback: (() => void) | undefined;
  let timersSet = 0;
  let resolveSurfaced: (failure: Error) => void = () => {};
  const surfaced: Promise<Error> = new Promise((resolve) => {
    resolveSurfaced = (failure) => resolve(failure);
  });

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
    async runDailyBackup() {
      backupRuns += 1;
      if (backupRuns === 2) {
        throw failure;
      }
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
