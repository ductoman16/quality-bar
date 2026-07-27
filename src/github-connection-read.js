/**
 * @param {{
 *   all(
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[]
 * }} durableCore
 */
export function readGitHubConnection(durableCore) {
  const [row] = durableCore.all(
    `SELECT
       id, app_id, app_slug, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count,
       health, health_error_code, health_error_message, verified_at
     FROM github_connections
     LIMIT 1`,
  );
  if (!row) {
    return null;
  }
  if (
    typeof row.id !== "string" ||
    !Number.isSafeInteger(row.app_id) ||
    typeof row.app_slug !== "string" ||
    !Number.isSafeInteger(row.principal_id) ||
    typeof row.principal_login !== "string" ||
    typeof row.api_profile !== "string" ||
    typeof row.permissions !== "string" ||
    typeof row.capabilities !== "string" ||
    !Number.isSafeInteger(row.repository_count) ||
    !["healthy", "error"].includes(/** @type {string} */ (row.health)) ||
    !Number.isSafeInteger(row.verified_at)
  ) {
    throw new TypeError("GitHub Connection row is invalid");
  }
  const healthError =
    row.health === "error"
      ? {
          code: /** @type {string} */ (row.health_error_code),
          message: /** @type {string} */ (row.health_error_message),
        }
      : null;
  if (
    (row.health === "healthy" &&
      (row.health_error_code !== null || row.health_error_message !== null)) ||
    (row.health === "error" &&
      (typeof healthError?.code !== "string" ||
        healthError.code.length === 0 ||
        typeof healthError.message !== "string" ||
        healthError.message.length === 0))
  ) {
    throw new TypeError("GitHub Connection health error is invalid");
  }
  const history = durableCore
    .all(
      `SELECT
         rowid AS sequence, id, trigger, outcome, error_code, error_message,
         error_repository_id, api_profile, principal_id, principal_login,
         permissions, capabilities, affected_repository_ids,
         repository_checks, repositories, verified_at
       FROM github_connection_verifications
       WHERE connection_id = ?
       ORDER BY sequence`,
      row.id,
    )
    .map((verification) => {
      if (
        !verification ||
        typeof verification.id !== "string" ||
        typeof verification.trigger !== "string" ||
        !["success", "error"].includes(
          /** @type {string} */ (verification.outcome),
        ) ||
        !Number.isSafeInteger(verification.sequence) ||
        (verification.api_profile !== null &&
          typeof verification.api_profile !== "string") ||
        (verification.principal_id !== null &&
          !Number.isSafeInteger(verification.principal_id)) ||
        (verification.principal_login !== null &&
          typeof verification.principal_login !== "string") ||
        (verification.permissions !== null &&
          typeof verification.permissions !== "string") ||
        (verification.capabilities !== null &&
          typeof verification.capabilities !== "string") ||
        typeof verification.affected_repository_ids !== "string" ||
        typeof verification.repository_checks !== "string" ||
        typeof verification.repositories !== "string" ||
        !Number.isSafeInteger(verification.verified_at)
      ) {
        throw new TypeError("GitHub Connection Verification row is invalid");
      }
      const error =
        verification.outcome === "error"
          ? {
              code: verification.error_code,
              message: verification.error_message,
              repository_id: verification.error_repository_id,
            }
          : null;
      const affectedRepositoryIds = JSON.parse(
        verification.affected_repository_ids,
      );
      const repositories = JSON.parse(verification.repositories);
      const repositoryChecks = JSON.parse(verification.repository_checks);
      if (
        !Array.isArray(affectedRepositoryIds) ||
        affectedRepositoryIds.length === 0 ||
        new Set(affectedRepositoryIds).size !== affectedRepositoryIds.length ||
        affectedRepositoryIds.some(
          (id) => !Number.isSafeInteger(id) || id <= 0,
        ) ||
        !Array.isArray(repositories) ||
        !Array.isArray(repositoryChecks) ||
        repositoryChecks.length !== affectedRepositoryIds.length ||
        new Set(repositoryChecks.map((check) => check?.repository_id)).size !==
          repositoryChecks.length ||
        repositoryChecks.some(
          (check) =>
            !check ||
            typeof check !== "object" ||
            !affectedRepositoryIds.includes(check.repository_id) ||
            !["error", "not_completed", "success"].includes(check.outcome),
        ) ||
        (verification.principal_id === null) !==
          (verification.principal_login === null) ||
        (verification.outcome === "success" &&
          (verification.error_code !== null ||
            verification.error_message !== null ||
            verification.error_repository_id !== null ||
            typeof verification.api_profile !== "string" ||
            !Number.isSafeInteger(verification.principal_id) ||
            typeof verification.principal_login !== "string" ||
            typeof verification.permissions !== "string" ||
            typeof verification.capabilities !== "string" ||
            repositories.length === 0)) ||
        (verification.outcome === "error" &&
          (typeof error?.code !== "string" ||
            error.code.length === 0 ||
            typeof error.message !== "string" ||
            error.message.length === 0 ||
            (error.repository_id !== null &&
              (!Number.isSafeInteger(error.repository_id) ||
                !affectedRepositoryIds.includes(error.repository_id)))))
      ) {
        throw new TypeError(
          "GitHub Connection Verification outcome is invalid",
        );
      }
      return {
        api_profile: verification.api_profile,
        affected_repository_ids: affectedRepositoryIds,
        capabilities:
          verification.capabilities === null
            ? null
            : JSON.parse(verification.capabilities),
        error,
        id: verification.id,
        outcome: verification.outcome,
        permissions:
          verification.permissions === null
            ? null
            : JSON.parse(verification.permissions),
        principal:
          verification.principal_id === null
            ? null
            : {
                id: verification.principal_id,
                login: verification.principal_login,
                type: "User",
              },
        repositories,
        repository_checks: repositoryChecks,
        trigger: verification.trigger,
        verified_at: verification.verified_at,
      };
    });
  return {
    api_profile: row.api_profile,
    app_id: row.app_id,
    app_slug: row.app_slug,
    capabilities: JSON.parse(row.capabilities),
    health: /** @type {"healthy" | "error"} */ (row.health),
    health_error: healthError,
    id: row.id,
    permissions: JSON.parse(row.permissions),
    principal: {
      id: row.principal_id,
      login: row.principal_login,
      type: "User",
    },
    repository_count: row.repository_count,
    verification_history: history,
    verified_at: row.verified_at,
  };
}
