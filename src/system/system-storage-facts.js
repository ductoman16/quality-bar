import { readValidatedBackups } from "../validated-backup.js";

const APPLICATION_VERSION = /^\d+\.\d+\.\d+$/;
const KEY_IDENTITY = /^sha256:[0-9a-f]{64}$/;

/**
 * @typedef {{
 *   applicationVersion: string,
 *   createdAt: string,
 *   keyIdentity: string,
 *   kind: "daily",
 * }} ValidatedBackup
 */

/** @param {unknown} error */
function errorFact(error) {
  if (!(error instanceof Error)) {
    throw new TypeError("System storage failure is not an Error");
  }
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "system_storage_facts_unavailable";
  return { code, detail: error.message };
}

/** @param {unknown} value @param {string} name */
function requiredTimestamp(value, name) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${name} is invalid`);
  }
  const timestamp = new Date(value).toISOString();
  if (timestamp !== value) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

/** @param {unknown} value */
function requireBackup(value) {
  const record = /** @type {Record<string, unknown>} */ (
    value && typeof value === "object" ? value : {}
  );
  if (
    typeof record.applicationVersion !== "string" ||
    !APPLICATION_VERSION.test(record.applicationVersion) ||
    typeof record.createdAt !== "string" ||
    typeof record.keyIdentity !== "string" ||
    !KEY_IDENTITY.test(record.keyIdentity) ||
    record.kind !== "daily"
  ) {
    throw new TypeError("Validated backup fact is invalid");
  }
  requiredTimestamp(record.createdAt, "Validated backup timestamp");
  return /** @type {ValidatedBackup} */ (record);
}

/** @param {ValidatedBackup} backup */
function backupDocument(backup) {
  return {
    application_version: backup.applicationVersion,
    created_at: backup.createdAt,
    installation_key_identity: backup.keyIdentity,
    kind: backup.kind,
  };
}

/** @param {ValidatedBackup[]} backups */
function latestBackup(backups) {
  return backups
    .map(requireBackup)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/**
 * @param {{
 *   applicationVersion?: string,
 *   backupsPath: string,
 *   installationKeyIdentity?: string,
 *   now?: () => number,
 *   readBackups?: typeof readValidatedBackups
 * }} options
 */
export function readSystemStorageFacts({
  applicationVersion,
  backupsPath,
  installationKeyIdentity,
  now = () => Date.now(),
  readBackups = readValidatedBackups,
}) {
  if (
    typeof backupsPath !== "string" ||
    backupsPath.length === 0 ||
    typeof now !== "function" ||
    typeof readBackups !== "function"
  ) {
    throw new TypeError("System storage fact dependencies are invalid");
  }
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("System storage fact time is invalid");
  }
  const applicationError =
    typeof applicationVersion !== "string" ||
    !APPLICATION_VERSION.test(applicationVersion)
      ? {
          code: "application_version_unavailable",
          detail: "Application version is unavailable",
        }
      : typeof installationKeyIdentity !== "string" ||
          !KEY_IDENTITY.test(installationKeyIdentity)
        ? {
            code: "installation_key_identity_unavailable",
            detail: "Installation key identity is unavailable",
          }
        : null;
  const application = applicationError
    ? {
        application_version: null,
        installation_key_identity: null,
        status: "unavailable",
        error: applicationError,
      }
    : {
        application_version: applicationVersion,
        error: null,
        installation_key_identity: installationKeyIdentity,
        status: "available",
      };

  function readDailyBackups() {
    const records = readBackups({ backupsPath, kind: "daily" });
    if (!Array.isArray(records)) {
      throw new TypeError("Validated backup facts are not an array");
    }
    return records.map(requireBackup);
  }

  /** @type {ValidatedBackup[]} */
  let dailyBackups = [];
  let backupFailure = applicationError;
  if (!backupFailure) {
    try {
      dailyBackups = readDailyBackups();
    } catch (error) {
      backupFailure = errorFact(error);
    }
  }
  const daily = latestBackup(dailyBackups);
  let backup;
  if (backupFailure) {
    backup = {
      error: backupFailure,
      last_successful: null,
      status: "unavailable",
    };
  } else if (!daily) {
    backup = { error: null, last_successful: null, status: "empty" };
  } else {
    const utcDate = new Date(timestamp).toISOString().slice(0, 10);
    backup = {
      error: null,
      last_successful: backupDocument(daily),
      status:
        daily.createdAt.slice(0, 10) === utcDate &&
        daily.applicationVersion === applicationVersion &&
        daily.keyIdentity === installationKeyIdentity
          ? "current"
          : "stale",
    };
  }

  return { application, backup };
}
