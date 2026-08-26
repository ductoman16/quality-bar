import { loadInstallationConfiguration } from "../installation-configuration.ts";
import {
  STATE_PATH,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "../installation-environment.ts";
import { readOperatorPassword } from "./operator-password-bootstrap.ts";
import { runOperatorPasswordHostMutation } from "./operator-password-host.ts";
import { recoverOperatorAuthority } from "./operator-password.ts";

const DATABASE_PATH = `${STATE_PATH}/quality-bar.sqlite3`;

export async function recoverOperatorAuthorityFromHost({
  databasePath = DATABASE_PATH,
  loadInstallation = loadInstallationConfiguration,
  onAuthorityRecovered,
  readPassword = readOperatorPassword,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
}: {
  databasePath?: string;
  loadInstallation?: () => {
    freeSpaceReserveBytes: number;
    masterKey: Buffer;
  };
  onAuthorityRecovered?: () => void;
  readPassword?: () => string | Promise<string>;
  validateInstallation?: (options: { reserveBytes: number }) => {
    releaseInstallationLock?: () => void;
  };
  validateSources?: () => void;
} = {}) {
  return runOperatorPasswordHostMutation({
    databasePath,
    loadInstallation,
    mutate: recoverOperatorAuthority,
    onMutationCommitted: onAuthorityRecovered,
    readPassword,
    validateInstallation,
    validateSources,
  });
}
