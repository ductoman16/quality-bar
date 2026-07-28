import { openDurableCore } from "./durable-core.js";
import { SCHEMA_VERSION } from "./durable-schema.js";
import {
  finalizePreMigrationBackup,
  preparePreMigrationBackup,
} from "./installed-backup.js";
import { verifyInstallationKey } from "./installation-configuration.js";
import { installationKeyIdentity } from "./sqlite-backup.js";

/**
 * @param {Error} primaryFailure
 * @param {unknown[]} cleanupFailures
 */
function attachCleanupFailures(primaryFailure, cleanupFailures) {
  if (cleanupFailures.length === 0) {
    return;
  }
  primaryFailure.cause = new AggregateError(
    [
      ...(primaryFailure.cause === undefined ? [] : [primaryFailure.cause]),
      ...cleanupFailures,
    ],
    "Operator password host mutation and cleanup both failed",
  );
}

/** @param {unknown} failure */
function throwExactly(failure) {
  throw failure;
}

/**
 * @template Result
 * @param {{
 *   applicationVersion?: string,
 *   backupsPath: string,
 *   databasePath: string,
 *   loadInstallation: () => {
 *     freeSpaceReserveBytes: number,
 *     masterKey: Buffer,
 *   },
 *   mutate: (
 *     durableCore: ReturnType<typeof openDurableCore>,
 *     password: string,
 *   ) => Result,
 *   onMutationCommitted?: () => void,
 *   readPassword: () => string | Promise<string>,
 *   validateInstallation: (options: {
 *     reserveBytes: number,
 *   }) => {releaseInstallationLock?: () => void},
 *   validateSources: () => void,
 * }} input
 * @returns {Promise<Result>}
 */
export async function runOperatorPasswordHostMutation({
  applicationVersion,
  backupsPath,
  databasePath,
  loadInstallation,
  mutate,
  onMutationCommitted,
  readPassword,
  validateInstallation,
  validateSources,
}) {
  validateSources();
  const installation = loadInstallation();
  let durableCore;
  let releaseInstallationLock;
  let mutationFailed = false;
  /** @type {unknown} */
  let primaryFailure;
  /** @type {Result | undefined} */
  let result;

  try {
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    const preMigrationBackup = await preparePreMigrationBackup({
      applicationVersion: /** @type {string} */ (applicationVersion),
      backupsPath,
      databasePath,
      keyIdentity: installationKeyIdentity(installation.masterKey),
      targetSchemaVersion: SCHEMA_VERSION,
    });
    durableCore = openDurableCore(databasePath);
    verifyInstallationKey(durableCore, installation.masterKey);
    if (preMigrationBackup) {
      finalizePreMigrationBackup(backupsPath);
    }
    result = mutate(durableCore, await readPassword());
    onMutationCommitted?.();
  } catch (error) {
    mutationFailed = true;
    primaryFailure = error;
  }

  /** @type {unknown[]} */
  const cleanupFailures = [];
  try {
    durableCore?.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    installation.masterKey.fill(0);
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    releaseInstallationLock?.();
  } catch (error) {
    cleanupFailures.push(error);
  }

  if (mutationFailed) {
    if (primaryFailure instanceof Error) {
      attachCleanupFailures(primaryFailure, cleanupFailures);
    }
    throwExactly(primaryFailure);
  }
  if (cleanupFailures.length > 0) {
    const [cleanupFailure, ...additionalCleanupFailures] = cleanupFailures;
    if (cleanupFailure instanceof Error) {
      attachCleanupFailures(cleanupFailure, additionalCleanupFailures);
    }
    throwExactly(cleanupFailure);
  }
  return /** @type {Result} */ (result);
}
