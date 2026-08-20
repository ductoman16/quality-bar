import { closedObject } from "./canonical-schema.js";

const error = { $ref: "SystemStorageError#" };
const nullableError = { oneOf: [error, { type: "null" }] };
const nullableTimestamp = { format: "date-time", type: ["string", "null"] };

export function canonicalSystemStorageSchemas() {
  return {
    SystemStorageError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    SystemApplicationFact: closedObject(
      {
        application_version: { type: ["string", "null"] },
        error: nullableError,
        installation_key_identity: {
          pattern: "^sha256:[0-9a-f]{64}$",
          type: ["string", "null"],
        },
        schema_version: { minimum: 1, type: ["integer", "null"] },
        status: { enum: ["available", "unavailable"], type: "string" },
      },
      [
        "application_version",
        "error",
        "installation_key_identity",
        "schema_version",
        "status",
      ],
    ),
    SystemBackupRecord: closedObject(
      {
        application_version: {
          pattern: "^\\d+\\.\\d+\\.\\d+$",
          type: "string",
        },
        created_at: { format: "date-time", type: "string" },
        installation_key_identity: {
          pattern: "^sha256:[0-9a-f]{64}$",
          type: "string",
        },
        kind: { enum: ["daily", "pre-migration"], type: "string" },
        schema_version: { minimum: 1, type: "integer" },
      },
      [
        "application_version",
        "created_at",
        "installation_key_identity",
        "kind",
        "schema_version",
      ],
    ),
    SystemBackupFact: closedObject(
      {
        error: nullableError,
        last_successful: {
          oneOf: [{ $ref: "SystemBackupRecord#" }, { type: "null" }],
        },
        status: {
          enum: ["current", "empty", "stale", "unavailable"],
          type: "string",
        },
      },
      ["error", "last_successful", "status"],
    ),
    SystemMigrationFact: closedObject(
      {
        error: nullableError,
        from_schema_version: { minimum: 1, type: "integer" },
        pre_migration_snapshot: {
          oneOf: [{ $ref: "SystemBackupRecord#" }, { type: "null" }],
        },
        pre_migration_snapshot_status: {
          enum: ["available", "missing", "not_applicable", "unavailable"],
          type: "string",
        },
        status: {
          enum: ["completed", "not_required", "unavailable"],
          type: "string",
        },
        to_schema_version: { minimum: 1, type: "integer" },
      },
      [
        "error",
        "from_schema_version",
        "pre_migration_snapshot",
        "pre_migration_snapshot_status",
        "status",
        "to_schema_version",
      ],
    ),
    SystemStorageCleanupFact: closedObject(
      {
        artifacts_removed: { minimum: 0, type: ["integer", "null"] },
        error: nullableError,
        last_run_at: nullableTimestamp,
        sessions_removed: { minimum: 0, type: ["integer", "null"] },
        status: {
          enum: ["available", "not_run", "running", "unavailable"],
          type: "string",
        },
      },
      [
        "artifacts_removed",
        "error",
        "last_run_at",
        "sessions_removed",
        "status",
      ],
    ),
  };
}
