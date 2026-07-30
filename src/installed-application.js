import { createApplication } from "./application.js";
import { loadInstallationConfiguration } from "./installation-configuration.js";
import {
  BACKUPS_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";
import {
  finalizePreMigrationBackup,
  preparePreMigrationBackup,
  runDailyBackupIfDue,
} from "./installed-backup.js";
import { SCHEMA_VERSION } from "./durable-schema.js";
import { failBackup } from "./sqlite-backup-error.js";
import { installationKeyIdentity } from "./sqlite-backup.js";

const DAILY_BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

/** @typedef {{unref: () => unknown}} BackupTimer */

/**
 * @param {unknown} error
 * @returns {Error & {code: string}}
 */
function codedBackupFailure(error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return /** @type {Error & {code: string}} */ (error);
  }
  throw error;
}

/**
 * @param {(line: string) => unknown} writeLog
 * @param {Error & {code: string}} error
 */
function logBackupFailure(writeLog, error) {
  writeLog(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "error",
      event: "backup_failed",
      component: "backup",
      outcome: "failure",
      error: error.code,
      detail: error.message,
    })}\n`,
  );
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
 *   clearBackupTimer?: (timer: BackupTimer) => unknown,
 *   createRuntime?: typeof createApplication,
 *   databasePath: string,
 *   finalizeBackup?: typeof finalizePreMigrationBackup,
 *   loadInstallation?: typeof loadInstallationConfiguration,
 *   now?: () => number,
 *   prepareBackup?: typeof preparePreMigrationBackup,
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
  clearBackupTimer = (timer) =>
    clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
  createRuntime = createApplication,
  databasePath,
  finalizeBackup = finalizePreMigrationBackup,
  loadInstallation = loadInstallationConfiguration,
  now = () => Date.now(),
  prepareBackup = preparePreMigrationBackup,
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
  let preMigrationBackup = null;
  let keyIdentity = "";
  try {
    validateSources();
    installation = loadInstallation();
    keyIdentity = installationKeyIdentity(installation.masterKey);
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    preMigrationBackup = await prepareBackup({
      applicationVersion,
      backupsPath,
      databasePath,
      keyIdentity,
      now,
      targetSchemaVersion: SCHEMA_VERSION,
    });
  } catch (error) {
    preflightFailure = error;
    releaseInstallationLock?.();
    releaseInstallationLock = undefined;
  }

  if (preflightFailure) {
    installation?.masterKey.fill(0);
    return createRuntime({
      databasePath,
      validateSources() {
        throw preflightFailure;
      },
      writeLog,
    });
  }

  const application = createRuntime({
    databasePath,
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
  if (preMigrationBackup) {
    try {
      finalizeBackup(backupsPath);
    } catch (error) {
      const failure = codedBackupFailure(error);
      logBackupFailure(writeLog, failure);
      throw await closeAfterBackupFailure(application, failure);
    }
  }

  const dailyBackupInput = {
    applicationVersion,
    backupsPath,
    databasePath,
    keyIdentity,
    now,
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
      void runDailyBackup(dailyBackupInput).then(
        () => {
          if (!stopped) {
            scheduleBackupCheck();
          }
        },
        async (error) => {
          if (application.workerSignal.aborted) {
            return;
          }
          const failure = codedBackupFailure(error);
          logBackupFailure(writeLog, failure);
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
