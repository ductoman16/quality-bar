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
         id, trigger, outcome, error_code, error_message, api_profile,
         principal_id, principal_login, permissions, capabilities,
         repositories, verified_at
       FROM github_connection_verifications
       WHERE connection_id = ?
       ORDER BY verified_at, id`,
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
        typeof verification.api_profile !== "string" ||
        !Number.isSafeInteger(verification.principal_id) ||
        typeof verification.principal_login !== "string" ||
        typeof verification.permissions !== "string" ||
        typeof verification.capabilities !== "string" ||
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
            }
          : null;
      if (
        (verification.outcome === "success" &&
          (verification.error_code !== null ||
            verification.error_message !== null)) ||
        (verification.outcome === "error" &&
          (typeof error?.code !== "string" ||
            error.code.length === 0 ||
            typeof error.message !== "string" ||
            error.message.length === 0))
      ) {
        throw new TypeError(
          "GitHub Connection Verification outcome is invalid",
        );
      }
      return {
        api_profile: verification.api_profile,
        capabilities: JSON.parse(verification.capabilities),
        error,
        id: verification.id,
        outcome: verification.outcome,
        permissions: JSON.parse(verification.permissions),
        principal: {
          id: verification.principal_id,
          login: verification.principal_login,
          type: "User",
        },
        repositories: JSON.parse(verification.repositories),
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
