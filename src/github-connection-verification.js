/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {string} connectionId
 */
export function readLatestGitHubRepositoryEvidence(durableCore, connectionId) {
  const [row] = durableCore.all(
    `SELECT repositories
     FROM github_connection_verifications
     WHERE connection_id = ?
     ORDER BY verified_at DESC, id DESC
     LIMIT 1`,
    connectionId,
  );
  if (!row || typeof row.repositories !== "string") {
    throw new TypeError("GitHub Connection verification evidence is missing");
  }
  const repositories = JSON.parse(row.repositories);
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw new TypeError("GitHub Connection Repository evidence is invalid");
  }
  return repositories;
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {{
 *   capabilities: string,
 *   createId: () => string | undefined,
 *   error?: {code: string, message: string, repositoryId?: number, scope: "connection" | "repository"},
 *   evidence: unknown[],
 *   id: string,
 *   permissions: string,
 *   principalId: number,
 *   principalLogin: string,
 *   profile: string,
 *   timestamp: () => number,
 *   trigger: "enablement" | "repository_selection"
 * }} input
 */
export function recordGitHubConnectionVerification(durableCore, input) {
  const verificationId = input.createId();
  const verifiedAt = input.timestamp();
  if (
    typeof verificationId !== "string" ||
    verificationId.length === 0 ||
    !Number.isSafeInteger(verifiedAt)
  ) {
    throw new TypeError("GitHub Connection verification identity is invalid");
  }
  if (
    input.error?.scope === "repository" &&
    !Number.isSafeInteger(input.error.repositoryId)
  ) {
    throw new TypeError("GitHub Repository verification scope is invalid");
  }
  const errorCode = input.error?.code ?? null;
  const errorMessage = input.error?.message ?? null;
  const outcome = input.error ? "error" : "success";
  durableCore.transaction((transaction) => {
    if (!input.error) {
      transaction.run(
        `UPDATE github_connections
         SET health = 'healthy',
             health_error_code = NULL,
             health_error_message = NULL,
             verified_at = ?
         WHERE id = ?`,
        verifiedAt,
        input.id,
      );
    } else if (input.error.scope === "connection") {
      transaction.run(
        `UPDATE github_connections
         SET health = 'error',
             health_error_code = ?,
             health_error_message = ?,
             verified_at = ?
         WHERE id = ?`,
        errorCode,
        errorMessage,
        verifiedAt,
        input.id,
      );
    } else {
      transaction.run(
        `UPDATE repositories
         SET health = 'error',
             health_error_code = ?,
             health_error_message = ?
         WHERE id = (
           SELECT repository_id
           FROM github_repositories
           WHERE connection_id = ? AND forge_repository_id = ?
         )`,
        errorCode,
        errorMessage,
        input.id,
        /** @type {number} */ (input.error.repositoryId),
      );
      transaction.run(
        "UPDATE github_connections SET verified_at = ? WHERE id = ?",
        verifiedAt,
        input.id,
      );
    }
    transaction.run(
      `INSERT INTO github_connection_verifications (
         id, connection_id, trigger, outcome, error_code, error_message,
         api_profile, principal_id, principal_login, permissions,
         capabilities, repositories, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      verificationId,
      input.id,
      input.trigger,
      outcome,
      errorCode,
      errorMessage,
      input.profile,
      input.principalId,
      input.principalLogin,
      input.permissions,
      input.capabilities,
      JSON.stringify(input.evidence),
      verifiedAt,
    );
  });
  return verifiedAt;
}
