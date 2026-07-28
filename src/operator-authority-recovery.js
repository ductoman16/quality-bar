import { loadInstallationConfiguration } from "./installation-configuration.js";
import {
  BACKUPS_PATH,
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";
import { readOperatorPassword } from "./operator-password-bootstrap.js";
import { runOperatorPasswordHostMutation } from "./operator-password-host.js";
import { recoverOperatorAuthority } from "./operator-password.js";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

/**
 * @param {{
 *   applicationVersion?: string,
 *   backupsPath?: string,
 *   databasePath?: string,
 *   loadInstallation?: () => {
 *     freeSpaceReserveBytes: number,
 *     masterKey: Buffer,
 *   },
 *   onAuthorityRecovered?: () => void,
 *   readPassword?: () => string | Promise<string>,
 *   validateInstallation?: (options: {
 *     reserveBytes: number,
 *   }) => {releaseInstallationLock?: () => void},
 *   validateSources?: () => void,
 * }} [options]
 */
export async function recoverOperatorAuthorityFromHost({
  applicationVersion,
  backupsPath = BACKUPS_PATH,
  databasePath = DATABASE_PATH,
  loadInstallation = loadInstallationConfiguration,
  onAuthorityRecovered,
  readPassword = readOperatorPassword,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
} = {}) {
  return runOperatorPasswordHostMutation({
    applicationVersion,
    backupsPath,
    databasePath,
    loadInstallation,
    mutate: recoverOperatorAuthority,
    onMutationCommitted: onAuthorityRecovered,
    readPassword,
    validateInstallation,
    validateSources,
  });
}
