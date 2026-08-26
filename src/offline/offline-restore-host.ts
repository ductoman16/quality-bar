import { restoreOfflineBackup } from "./offline-restore.ts";
import { loadInstallationConfiguration } from "../installation-configuration.ts";
import {
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "../installation-environment.ts";
import { readOperatorPassword } from "../operator/operator-password-bootstrap.ts";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

export async function restoreOfflineBackupFromHost({
  applicationVersion,
  databasePath = DATABASE_PATH,
  loadInstallation = loadInstallationConfiguration,
  manifestPath,
  readPassword = readOperatorPassword,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
}: {
  applicationVersion?: string;
  databasePath?: string;
  loadInstallation?: () => {
    freeSpaceReserveBytes: number;
    masterKey: Buffer;
  };
  manifestPath: string;
  readPassword?: () => string | Promise<string>;
  validateInstallation?: (options: { reserveBytes: number }) => {
    releaseInstallationLock?: () => void;
  };
  validateSources?: () => void;
}) {
  validateSources();
  const installation = loadInstallation();
  let releaseInstallationLock;
  let primaryFailure: unknown;
  let result;
  try {
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    const operatorPassword = await readPassword();
    result = await restoreOfflineBackup({
      applicationVersion: applicationVersion as string,
      databasePath,
      manifestPath,
      masterKey: installation.masterKey,
      operatorPassword,
    });
  } catch (error) {
    primaryFailure = error;
  }
  installation.masterKey.fill(0);
  let releaseFailure;
  try {
    releaseInstallationLock?.();
  } catch (error) {
    releaseFailure = error;
  }
  if (primaryFailure instanceof Error) {
    if (releaseFailure) {
      primaryFailure.cause = new AggregateError(
        [
          ...(primaryFailure.cause === undefined ? [] : [primaryFailure.cause]),
          releaseFailure,
        ],
        "Restore failure and installation lock release both failed",
      );
    }
    throw primaryFailure;
  }
  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }
  if (releaseFailure !== undefined) {
    throw releaseFailure;
  }
  return result as NonNullable<typeof result>;
}
