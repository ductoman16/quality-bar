import { createApplication } from "./application/application.ts";
import { loadInstallationConfiguration } from "./installation-configuration.ts";
import {
  BACKUPS_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.ts";
import { runDailyBackupIfDue } from "./installed-backup.ts";
import { failBackup } from "./sqlite-backup-error.ts";
import { installationKeyIdentity } from "./sqlite-backup.ts";

const DAILY_BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

export type BackupTimer = { unref: () => unknown };

function codedBackupFailure(
  error: unknown,
  fallbackCode: string = "backup_failed",
): Error & { code: string } {
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
  return error as Error & { code: string };
}

function logMaintenanceFailure(
  writeLog: (line: string) => unknown,
  error: Error & { code: string },
  event: string,
) {
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

function logBackupFailure(
  writeLog: (line: string) => unknown,
  error: Error & { code: string },
) {
  logMaintenanceFailure(writeLog, error, "backup_failed");
}

function logRetentionCleanupFailure(
  writeLog: (line: string) => unknown,
  error: Error & { code: string },
) {
  logMaintenanceFailure(writeLog, error, "retention_cleanup_failed");
}

async function closeAfterBackupFailure(
  application: { close: () => Promise<void> },
  failure: Error & { code: string },
) {
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

export async function createInstalledApplication({
  applicationVersion,
  backupsPath = BACKUPS_PATH,
  certificateAuthorityPath,
  clearBackupTimer = (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>),
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
}: {
  applicationVersion: string | undefined;
  backupsPath?: string;
  certificateAuthorityPath?: string;
  clearBackupTimer?: (timer: BackupTimer) => unknown;
  createRuntime?: typeof createApplication;
  databasePath: string;
  loadInstallation?: typeof loadInstallationConfiguration;
  now?: () => number;
  runDailyBackup?: typeof runDailyBackupIfDue;
  setBackupTimer?: (callback: () => void, delay: number) => BackupTimer;
  surfaceBackupFailure?: (failure: Error) => void;
  validateInstallation?: typeof validateInstallationFilesystem;
  validateSources?: typeof validateInstallationSources;
  writeLog?: (line: string) => unknown;
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

  validateSources();
  const installation = loadInstallation();
  const keyIdentity = installationKeyIdentity(installation.masterKey);
  const { releaseInstallationLock } = validateInstallation({
    reserveBytes: installation.freeSpaceReserveBytes,
  });

  let application: Awaited<ReturnType<typeof createApplication>>;
  try {
    application = createRuntime({
      applicationVersion,
      backupsPath,
      certificateAuthorityPath,
      databasePath,
      installationKeyIdentity: keyIdentity,
      loadInstallation: () => installation,
      validateInstallation: () => ({ releaseInstallationLock }),
      validateSources: () => {},
      writeLog,
    });
  } catch (error) {
    installation.masterKey.fill(0);
    releaseInstallationLock();
    throw error;
  }
  installation.masterKey.fill(0);
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
  let timer: BackupTimer | undefined;
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
