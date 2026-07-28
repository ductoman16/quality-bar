import { restoreOfflineBackup } from "./offline-restore.js";
import { loadInstallationConfiguration } from "./installation-configuration.js";
import {
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

/**
 * @param {{
 *   applicationVersion?: string,
 *   databasePath?: string,
 *   loadInstallation?: () => {
 *     freeSpaceReserveBytes: number,
 *     masterKey: Buffer,
 *   },
 *   manifestPath: string,
 *   validateInstallation?: (options: {
 *     reserveBytes: number,
 *   }) => {releaseInstallationLock?: () => void},
 *   validateSources?: () => void,
 * }} input
 */
export async function restoreOfflineBackupFromHost({
  applicationVersion,
  databasePath = DATABASE_PATH,
  loadInstallation = loadInstallationConfiguration,
  manifestPath,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
}) {
  validateSources();
  const installation = loadInstallation();
  let releaseInstallationLock;
  /** @type {unknown} */
  let primaryFailure;
  let result;
  try {
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    result = await restoreOfflineBackup({
      applicationVersion: /** @type {string} */ (applicationVersion),
      databasePath,
      manifestPath,
      masterKey: installation.masterKey,
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
  return /** @type {NonNullable<typeof result>} */ (result);
}
