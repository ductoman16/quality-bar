import { createApplication } from "./application/application.js";
import { loadInstallationConfiguration } from "./installation-configuration.js";
import {
  BACKUPS_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";
import { runDailyBackupIfDue } from "./installed-backup.js";
import { SCHEMA_VERSION } from "./durable/durable-schema.js";
import { failBackup } from "./sqlite-backup-error.js";
import { installationKeyIdentity } from "./sqlite-backup.js";

const DAILY_BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

/** @typedef {{unref: () => unknown}} BackupTimer */

/**
 * @param {unknown} error
 * @param {string} [fallbackCode]
 * @returns {Error & {code: string}}
 */
function codedBackupFailure(error, fallbackCode = "backup_failed") {
  if (!(error instanceof Error)) {
    return Object.assign(new TypeError("Maintenance failure is not an Error"), {
      code: fallbackCode,
    });
  }
  if (!("code" in error) || typeof error.code !== "string") {
    Object.defineProperty(error, "code", {
      configurable: true,
      value: fallbackCode,
    });
  }
  return /** @type {Error & {code: string}} */ (error);
}

/**
 * @param {(line: string) => unknown} writeLog
 * @param {Error & {code: string}} error
 * @param {string} event
 */
function logMaintenanceFailure(writeLog, error, event) {
  writeLog(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "error",
      event,
      component: "backup",
      outcome: "failure",
      error: error.code,
      detail: error.message,
    })}\n`,
  );
}

/** @param {(line: string) => unknown} writeLog @param {Error & {code: string}} error */
function logBackupFailure(writeLog, error) {
  logMaintenanceFailure(writeLog, error, "backup_failed");
}

/** @param {(line: string) => unknown} writeLog @param {Error & {code: string}} error */
function logRetentionCleanupFailure(writeLog, error) {
  logMaintenanceFailure(writeLog, error, "retention_cleanup_failed");
}

/**
 * @param {{close: () => Promise<void>}} application
 * @param {Error & {code: string}} failure
 */
async function closeAfterBackupFailure(application, failure) {
  try {
    await application.close();
  } catch (closeError) {
    failure.cause = new AggregateError(
      [failure.cause ?? failure, closeError],
      "SQLite backup failure and application shutdown both failed",
    );
  }
  return failure;
}

/**
 * @param {{
 *   applicationVersion: string | undefined,
 *   backupsPath?: string,
 *   certificateAuthorityPath?: string,
 *   clearBackupTimer?: (timer: BackupTimer) => unknown,
 *   createRuntime?: typeof createApplication,
 *   databasePath: string,
 *   loadInstallation?: typeof loadInstallationConfiguration,
 *   now?: () => number,
 *   runDailyBackup?: typeof runDailyBackupIfDue,
 *   setBackupTimer?: (callback: () => void, delay: number) => BackupTimer,
 *   surfaceBackupFailure?: (failure: Error) => void,
 *   validateInstallation?: typeof validateInstallationFilesystem,
 *   validateSources?: typeof validateInstallationSources,
 *   writeLog?: (line: string) => unknown,
 * }} options
 */
export async function createInstalledApplication({
  applicationVersion,
  backupsPath = BACKUPS_PATH,
  certificateAuthorityPath,
  clearBackupTimer = (timer) =>
    clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
  createRuntime = createApplication,
  databasePath,
  loadInstallation = loadInstallationConfiguration,
  now = () => Date.now(),
  runDailyBackup = runDailyBackupIfDue,
  setBackupTimer = (callback, delay) => setTimeout(callback, delay),
  surfaceBackupFailure = (failure) => {
    setImmediate(() => {
      throw failure;
    });
  },
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
  writeLog = (line) => process.stderr.write(line),
}) {
  if (
    typeof applicationVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(applicationVersion)
  ) {
    failBackup(
      "application_version_invalid",
      "QUALITY_BAR_VERSION must be a semantic version",
    );
  }

  /** @type {ReturnType<typeof loadInstallationConfiguration> | undefined} */
  let installation;
  /** @type {(() => void) | undefined} */
  let releaseInstallationLock;
  let preflightFailure;
  let keyIdentity = "";
  try {
    validateSources();
    installation = loadInstallation();
    keyIdentity = installationKeyIdentity(installation.masterKey);
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
  } catch (error) {
    preflightFailure = error;
  }

  if (preflightFailure) {
    installation?.masterKey.fill(0);
    let application;
    try {
      application = createRuntime({
        applicationVersion,
        backupsPath,
        certificateAuthorityPath,
        databasePath,
        installationKeyIdentity: keyIdentity,
        validateSources() {
          throw preflightFailure;
        },
        writeLog,
      });
    } catch (error) {
      releaseInstallationLock?.();
      releaseInstallationLock = undefined;
      throw error;
    }
    if (releaseInstallationLock) {
      const closeApplication = application.close.bind(application);
      let lockReleased = false;
      application.close = async () => {
        try {
          return await closeApplication();
        } finally {
          if (!lockReleased) {
            lockReleased = true;
            releaseInstallationLock?.();
            releaseInstallationLock = undefined;
          }
        }
      };
    }
    return application;
  }

  const application = createRuntime({
    applicationVersion,
    backupsPath,
    certificateAuthorityPath,
    databasePath,
    installationKeyIdentity: keyIdentity,
    loadInstallation: () =>
      /** @type {NonNullable<typeof installation>} */ (installation),
    validateInstallation: () => ({
      releaseInstallationLock: /** @type {() => void} */ (
        releaseInstallationLock
      ),
    }),
    validateSources: () => {},
    writeLog,
  });
  installation?.masterKey.fill(0);
  if (!application.durableCore) {
    return application;
  }
  const dailyBackupInput = {
    applicationVersion,
    backupsPath,
    databasePath,
    keyIdentity,
    now,
    schemaVersion: SCHEMA_VERSION,
    signal: application.workerSignal,
  };
  try {
    await runDailyBackup(dailyBackupInput);
  } catch (error) {
    const failure = codedBackupFailure(error);
    logBackupFailure(writeLog, failure);
    throw await closeAfterBackupFailure(application, failure);
  }

  let stopped = false;
  /** @type {BackupTimer | undefined} */
  let timer;
  function stopBackupChecks() {
    stopped = true;
    if (timer) {
      clearBackupTimer(timer);
      timer = undefined;
    }
  }
  function scheduleBackupCheck() {
    timer = setBackupTimer(() => {
      if (stopped) {
        return;
      }
      timer = undefined;
      let maintenance = "backup";
      void runDailyBackup(dailyBackupInput)
        .then(async () => {
          maintenance = "retention_cleanup";
          if (typeof application.cleanupEligibleData !== "function") {
            throw Object.assign(
              new Error("Retention cleanup capability is unavailable"),
              { code: "retention_cleanup_unavailable" },
            );
          }
          await application.cleanupEligibleData();
        })
        .then(
          () => {
            if (!stopped) {
              scheduleBackupCheck();
            }
          },
          async (error) => {
            if (
              application.workerSignal.aborted &&
              error === application.workerSignal.reason
            ) {
              return;
            }
            const failure = codedBackupFailure(
              error,
              maintenance === "retention_cleanup"
                ? "retention_cleanup_failed"
                : "backup_failed",
            );
            if (maintenance === "retention_cleanup") {
              logRetentionCleanupFailure(writeLog, failure);
            } else {
              logBackupFailure(writeLog, failure);
            }
            stopped = true;
            const surfacedFailure = await closeAfterBackupFailure(
              application,
              failure,
            );
            surfaceBackupFailure(surfacedFailure);
          },
        );
    }, DAILY_BACKUP_CHECK_INTERVAL_MS);
    timer.unref();
  }
  scheduleBackupCheck();
  application.workerSignal.addEventListener("abort", stopBackupChecks, {
    once: true,
  });
  if (application.workerSignal.aborted) {
    stopBackupChecks();
  }

  const closeApplication = application.close.bind(application);
  application.close = async () => {
    application.workerSignal.removeEventListener("abort", stopBackupChecks);
    stopBackupChecks();
    await closeApplication();
  };
  return application;
}
