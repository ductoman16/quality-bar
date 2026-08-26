import { GitHubConnectionError } from "./github-connection-error.ts";

export function failGitHubConnectionRotation(
  code: string,
  message: string,
): never {
  throw new GitHubConnectionError(code, message);
}

export function rotationRequest(input: unknown) {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    failGitHubConnectionRotation(
      "github_connection_rotation_request_invalid",
      "GitHub App credential rotation request is invalid",
    );
  }
  const value = input as Record<string, unknown>;
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameJson(value: unknown, expected: unknown) {
  return canonicalJson(value) === canonicalJson(expected);
}

export function repositoryId(row: Record<string, unknown> | undefined) {
  return row && Number.isSafeInteger(row.forge_repository_id)
    ? Number(row.forge_repository_id)
    : null;
}

export function uniquePositiveIds(ids: number[]) {
  return ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ? ids
    : null;
}

export function unionPositiveIds(groups: number[][]) {
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

export function requireCurrentGitHubConnectionRotation(
  transaction: any,
  connection: Record<string, any>,
  activeRepositoryIds: number[],
  message: string,
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
