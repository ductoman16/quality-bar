import { readValidatedBackups } from "./validated-backup.js";

const APPLICATION_VERSION = /^\d+\.\d+\.\d+$/;
const KEY_IDENTITY = /^sha256:[0-9a-f]{64}$/;

/**
 * @typedef {{
 *   applicationVersion: string,
 *   createdAt: string,
 *   keyIdentity: string,
 *   kind: "daily" | "pre-migration",
 *   schemaVersion: number
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
    !["daily", "pre-migration"].includes(/** @type {string} */ (record.kind)) ||
    !Number.isSafeInteger(record.schemaVersion) ||
    /** @type {number} */ (record.schemaVersion) <= 0
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
    schema_version: backup.schemaVersion,
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
 *   durableCore: {facts: {schemaVersion: number, schemaVersionBeforeMigration?: number}},
 *   installationKeyIdentity?: string,
 *   now?: () => number,
 *   readBackups?: typeof readValidatedBackups
 * }} options
 */
export function readSystemStorageFacts({
  applicationVersion,
  backupsPath,
  durableCore,
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
  const currentSchemaVersion = durableCore?.facts?.schemaVersion;
  if (
    !Number.isSafeInteger(currentSchemaVersion) ||
    currentSchemaVersion <= 0
  ) {
    throw new TypeError("System storage schema version is invalid");
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
        schema_version: null,
        status: "unavailable",
        error: applicationError,
      }
    : {
        application_version: applicationVersion,
        error: null,
        installation_key_identity: installationKeyIdentity,
        schema_version: currentSchemaVersion,
        status: "available",
      };

  /** @param {"daily" | "pre-migration"} kind */
  function readBackupsFor(kind) {
    const records = readBackups({ backupsPath, kind });
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
      dailyBackups = readBackupsFor("daily");
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
        daily.keyIdentity === installationKeyIdentity &&
        daily.schemaVersion === currentSchemaVersion
          ? "current"
          : "stale",
    };
  }

  const storedSchemaVersionBeforeMigration =
    durableCore.facts.schemaVersionBeforeMigration ?? currentSchemaVersion;
  if (
    !Number.isSafeInteger(storedSchemaVersionBeforeMigration) ||
    storedSchemaVersionBeforeMigration < 0
  ) {
    throw new TypeError(
      "System storage pre-migration schema version is invalid",
    );
  }
  const schemaVersionBeforeMigration =
    storedSchemaVersionBeforeMigration === 0
      ? currentSchemaVersion
      : storedSchemaVersionBeforeMigration;
  if (schemaVersionBeforeMigration === currentSchemaVersion) {
    return {
      application,
      backup,
      migration: {
        error: null,
        from_schema_version: currentSchemaVersion,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "not_applicable",
        status: "not_required",
        to_schema_version: currentSchemaVersion,
      },
    };
  }
  if (schemaVersionBeforeMigration > currentSchemaVersion) {
    return {
      application,
      backup,
      migration: {
        error: {
          code: "migration_schema_version_invalid",
          detail:
            "The durable core schema version is newer than the application",
        },
        from_schema_version: schemaVersionBeforeMigration,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "unavailable",
        status: "unavailable",
        to_schema_version: currentSchemaVersion,
      },
    };
  }

  /** @type {ValidatedBackup[]} */
  let preMigrationBackups = [];
  let migrationFailure = applicationError;
  if (!migrationFailure) {
    try {
      preMigrationBackups = readBackupsFor("pre-migration");
    } catch (error) {
      migrationFailure = errorFact(error);
    }
  }
  const preMigration = latestBackup(
    preMigrationBackups.filter(
      (candidate) =>
        candidate.schemaVersion === schemaVersionBeforeMigration &&
        candidate.keyIdentity === installationKeyIdentity,
    ),
  );
  if (migrationFailure) {
    return {
      application,
      backup,
      migration: {
        error: migrationFailure,
        from_schema_version: schemaVersionBeforeMigration,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "unavailable",
        status: "unavailable",
        to_schema_version: currentSchemaVersion,
      },
    };
  }
  if (!preMigration) {
    return {
      application,
      backup,
      migration: {
        error: {
          code: "prior_image_backup_unavailable",
          detail: "A validated prior-image backup is required before migration",
        },
        from_schema_version: schemaVersionBeforeMigration,
        pre_migration_snapshot: null,
        pre_migration_snapshot_status: "missing",
        status: "unavailable",
        to_schema_version: currentSchemaVersion,
      },
    };
  }
  return {
    application,
    backup,
    migration: {
      error: null,
      from_schema_version: schemaVersionBeforeMigration,
      pre_migration_snapshot: backupDocument(preMigration),
      pre_migration_snapshot_status: "available",
      status: "completed",
      to_schema_version: currentSchemaVersion,
    },
  };
}
