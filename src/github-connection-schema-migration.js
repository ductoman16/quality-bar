import { GITHUB_CONNECTION_ROTATION_MIGRATION } from "./github-connection-schema.js";

/** @param {import("node:sqlite").DatabaseSync} database @param {number} schemaVersion @param {number} currentVersion */
export function currentGitHubConnectionRotationMigration(
  database,
  schemaVersion,
  currentVersion,
) {
  if (schemaVersion !== currentVersion) {
    return "";
  }
  const table = database
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'github_connection_verifications'",
    )
    .get()?.sql;
  if (typeof table !== "string" || table.includes("'rotation'")) {
    return "";
  }
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(github_connection_verifications)")
      .all()
      .map((column) => column.name),
  );
  return [
    "outcome",
    "error_code",
    "error_message",
    "error_repository_id",
    "affected_repository_ids",
    "repository_checks",
  ].every((column) => columns.has(column))
    ? GITHUB_CONNECTION_ROTATION_MIGRATION
    : "";
}

/** @param {import("node:sqlite").DatabaseSync} database @param {(database: import("node:sqlite").DatabaseSync, statements: string) => void} migrateSchema @param {number} schemaVersion @param {number} currentVersion */
export function migrateGitHubConnectionRotationIfNeeded(
  database,
  migrateSchema,
  schemaVersion,
  currentVersion,
) {
  if (
    !currentGitHubConnectionRotationMigration(
      database,
      schemaVersion,
      currentVersion,
    )
  ) {
    return false;
  }
  migrateSchema(database, "");
  return true;
}
