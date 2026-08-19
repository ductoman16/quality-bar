"use strict";

const factsContainer = document.getElementById("system-storage-facts");
const VERSION = /^\d+\.\d+\.\d+$/;
const KEY_IDENTITY = /^sha256:[0-9a-f]{64}$/;

/** @param {any} error */
function requireError(error) {
  if (
    !error ||
    typeof error !== "object" ||
    typeof error.code !== "string" ||
    error.code.length === 0 ||
    typeof error.detail !== "string" ||
    error.detail.length === 0
  ) {
    throw new Error("system_storage_error_invalid");
  }
  return error;
}

/** @param {any} record */
function requireBackupRecord(record) {
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.application_version !== "string" ||
    !VERSION.test(record.application_version) ||
    typeof record.created_at !== "string" ||
    typeof record.installation_key_identity !== "string" ||
    !KEY_IDENTITY.test(record.installation_key_identity) ||
    record.kind !== "daily" ||
    !Number.isSafeInteger(record.schema_version) ||
    record.schema_version <= 0
  ) {
    throw new Error("system_storage_backup_record_invalid");
  }
  return record;
}

/** @param {any} value */
function requireStorageFacts(value) {
  if (!value || typeof value !== "object") {
    throw new Error("system_storage_facts_invalid");
  }
  const application = value.application;
  if (
    !application ||
    typeof application !== "object" ||
    !["available", "unavailable"].includes(application.status) ||
    !(
      application.application_version === null ||
      (typeof application.application_version === "string" &&
        VERSION.test(application.application_version))
    ) ||
    !(
      application.installation_key_identity === null ||
      (typeof application.installation_key_identity === "string" &&
        KEY_IDENTITY.test(application.installation_key_identity))
    ) ||
    !(
      application.schema_version === null ||
      (Number.isSafeInteger(application.schema_version) &&
        application.schema_version > 0)
    )
  ) {
    throw new Error("system_storage_application_invalid");
  }
  if (application.error !== null) {
    requireError(application.error);
  }
  if (application.status === "available" && application.error !== null) {
    throw new Error("system_storage_application_invalid");
  }
  if (application.status === "unavailable") {
    requireError(application.error);
  }

  const backup = value.backup;
  if (
    !backup ||
    typeof backup !== "object" ||
    !["current", "empty", "stale", "unavailable"].includes(backup.status) ||
    !(
      backup.last_successful === null ||
      requireBackupRecord(backup.last_successful)
    )
  ) {
    throw new Error("system_storage_backup_invalid");
  }
  if (backup.error !== null) {
    requireError(backup.error);
  }
  if (backup.status === "unavailable") {
    requireError(backup.error);
  }
  if (backup.status !== "unavailable" && backup.error !== null) {
    throw new Error("system_storage_backup_invalid");
  }

  const cleanup = value.storage?.cleanup;
  if (
    !cleanup ||
    typeof cleanup !== "object" ||
    !["available", "not_run", "running", "unavailable"].includes(
      cleanup.status,
    ) ||
    !(
      cleanup.last_run_at === null || typeof cleanup.last_run_at === "string"
    ) ||
    !(
      cleanup.artifacts_removed === null ||
      (Number.isSafeInteger(cleanup.artifacts_removed) &&
        cleanup.artifacts_removed >= 0)
    ) ||
    !(
      cleanup.sessions_removed === null ||
      (Number.isSafeInteger(cleanup.sessions_removed) &&
        cleanup.sessions_removed >= 0)
    )
  ) {
    throw new Error("system_storage_cleanup_invalid");
  }
  if (cleanup.error !== null) {
    requireError(cleanup.error);
  }
  if (cleanup.status === "unavailable") {
    requireError(cleanup.error);
  }
  if (cleanup.status !== "unavailable" && cleanup.error !== null) {
    throw new Error("system_storage_cleanup_invalid");
  }
  return value;
}

/** @param {string} name @param {string} value */
function storageDefinition(name, value) {
  const term = document.createElement("dt");
  term.textContent = name;
  const description = document.createElement("dd");
  description.textContent = value;
  return [term, description];
}

document.addEventListener("quality-bar:system-loaded", (event) => {
  if (!factsContainer) {
    throw new Error("system_storage_facts_missing");
  }
  const value = requireStorageFacts(/** @type {any} */ (event).detail);
  const { application, backup } = value;
  const cleanup = value.storage.cleanup;
  const cleanupValue = cleanup.error
    ? `${cleanup.status} — ${cleanup.error.code}: ${cleanup.error.detail}`
    : `${cleanup.status} — artifacts ${cleanup.artifacts_removed ?? "none"} — sessions ${cleanup.sessions_removed ?? "none"}`;
  const backupValue = backup.last_successful
    ? `${backup.last_successful.created_at} — ${backup.last_successful.application_version} — schema ${backup.last_successful.schema_version}`
    : backup.error
      ? `${backup.error.code}: ${backup.error.detail}`
      : "none";
  factsContainer.replaceChildren(
    ...[
      ...storageDefinition(
        "Application",
        application.error
          ? application.error.detail
          : `${application.application_version} — ${application.status}`,
      ),
      ...storageDefinition(
        "Installation key identity",
        application.installation_key_identity ?? "—",
      ),
      ...storageDefinition(
        "Schema",
        application.schema_version === null
          ? "—"
          : String(application.schema_version),
      ),
      ...storageDefinition("Owned cleanup", cleanupValue),
      ...storageDefinition(
        "Last successful backup",
        `${backup.status} — ${backupValue}`,
      ),
    ],
  );
});
