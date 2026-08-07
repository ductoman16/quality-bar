import { GitHubConnectionError } from "./github-connection-error.js";

/** @param {string} code @param {string} message @returns {never} */
export function failGitHubConnectionRotation(code, message) {
  throw new GitHubConnectionError(code, message);
}

/** @param {unknown} input */
export function rotationRequest(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    failGitHubConnectionRotation(
      "github_connection_rotation_request_invalid",
      "GitHub App credential rotation request is invalid",
    );
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (
    Object.keys(value).length !== 1 ||
    typeof value.pem !== "string" ||
    value.pem.length === 0
  ) {
    failGitHubConnectionRotation(
      "github_connection_rotation_request_invalid",
      "GitHub App credential rotation request is invalid",
    );
  }
  return { pem: value.pem };
}

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** @param {unknown} value @param {unknown} expected */
export function sameJson(value, expected) {
  return canonicalJson(value) === canonicalJson(expected);
}

/** @param {Record<string, unknown> | undefined} row */
export function repositoryId(row) {
  return row && Number.isSafeInteger(row.forge_repository_id)
    ? Number(row.forge_repository_id)
    : null;
}

/** @param {number[]} ids */
export function uniquePositiveIds(ids) {
  return ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ? ids
    : null;
}

/** @param {number[][]} groups */
export function unionPositiveIds(groups) {
  const ids = [];
  const seen = new Set();
  for (const group of groups) {
    if (!Array.isArray(group)) {
      return null;
    }
    for (const id of group) {
      if (!Number.isSafeInteger(id) || id <= 0) {
        return null;
      }
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return uniquePositiveIds(ids);
}

/**
 * @param {any} transaction
 * @param {Record<string, any>} connection
 * @param {number[]} activeRepositoryIds
 * @param {string} message
 */
export function requireCurrentGitHubConnectionRotation(
  transaction,
  connection,
  activeRepositoryIds,
  message,
) {
  const guarded = transaction.run(
    `UPDATE github_connections SET verified_at = verified_at
      WHERE id = ? AND app_id = ? AND app_slug = ?
        AND installation_id = ? AND principal_id = ?
        AND principal_login = ?
        AND EXISTS (
          SELECT 1 FROM github_connection_credentials
           WHERE connection_id = ? AND encrypted_credential = ?
        )
        AND (
          SELECT count(*)
            FROM github_repositories
            JOIN repositories ON repositories.id = github_repositories.repository_id
           WHERE github_repositories.connection_id = ?
             AND repositories.lifecycle = 'enabled'
        ) = ?
        AND NOT EXISTS (
          SELECT 1
            FROM github_repositories
            JOIN repositories ON repositories.id = github_repositories.repository_id
           WHERE github_repositories.connection_id = ?
             AND repositories.lifecycle = 'enabled'
             ${activeRepositoryIds.length > 0 ? `AND github_repositories.forge_repository_id NOT IN (${activeRepositoryIds.map(() => "?").join(", ")})` : ""}
        )`,
    connection.id,
    connection.app_id,
    connection.app_slug,
    connection.installation_id,
    connection.principal_id,
    connection.principal_login,
    connection.id,
    connection.encrypted_credential,
    connection.id,
    activeRepositoryIds.length,
    connection.id,
    ...activeRepositoryIds,
  );
  if (guarded.changes !== 1) {
    failGitHubConnectionRotation(
      "github_connection_rotation_conflict",
      message,
    );
  }
}
