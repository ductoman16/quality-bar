import { GitHubConnectionError } from "./github-connection-error.js";
import { normalizeGitHubRepositorySelection } from "./github-repository-selection.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new GitHubConnectionError(code, message);
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   transaction<Result>(callback: (transaction: {
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {{
 *   cipher: {decrypt(connection: {appId: number, id: string}, encrypted: string): {client_id: string, installation_id: number, pem: string}},
 *   createId: () => string | undefined,
 *   timestamp: () => number,
 *   verifier: {verifyRepositories?: (...parameters: any[]) => Promise<any>}
 * }} dependencies
 */
export function createGitHubRepositorySelector(
  durableCore,
  { cipher, createId, timestamp, verifier },
) {
  /** @param {unknown} request */
  return async function selectRepositories(request) {
    const repositoryIds = normalizeGitHubRepositorySelection(request);
    if (typeof verifier.verifyRepositories !== "function") {
      throw new TypeError(
        "GitHub verifier must provide Repository verification",
      );
    }
    const [connection] = durableCore.all(
      `SELECT
         github_connections.id,
         github_connections.app_id,
         github_connections.app_slug,
         github_connections.installation_id,
         github_connections.principal_id,
         github_connections.principal_login,
         github_connection_credentials.encrypted_credential
       FROM github_connections
       JOIN github_connection_credentials
         ON github_connection_credentials.connection_id = github_connections.id
       LIMIT 1`,
    );
    if (
      !connection ||
      typeof connection.id !== "string" ||
      !Number.isSafeInteger(connection.app_id) ||
      typeof connection.app_slug !== "string" ||
      !Number.isSafeInteger(connection.installation_id) ||
      !Number.isSafeInteger(connection.principal_id) ||
      typeof connection.principal_login !== "string" ||
      typeof connection.encrypted_credential !== "string"
    ) {
      fail(
        "github_connection_not_found",
        "GitHub Connection is not configured",
      );
    }
    const credential = cipher.decrypt(
      {
        appId: /** @type {number} */ (connection.app_id),
        id: connection.id,
      },
      connection.encrypted_credential,
    );
    const repositories = await verifier.verifyRepositories(
      {
        app_id: /** @type {number} */ (connection.app_id),
        app_slug: connection.app_slug,
        client_id: credential.client_id,
        owner: {
          id: /** @type {number} */ (connection.principal_id),
          login: connection.principal_login,
          type: "User",
        },
        pem: credential.pem,
      },
      /** @type {number} */ (connection.installation_id),
      repositoryIds,
    );
    if (
      !Array.isArray(repositories) ||
      repositories.length !== repositoryIds.length ||
      repositories.some(
        (repository) =>
          !repository ||
          !Number.isSafeInteger(repository.id) ||
          !repositoryIds.includes(repository.id) ||
          typeof repository.full_name !== "string" ||
          typeof repository.clone_url !== "string" ||
          typeof repository.api_url !== "string" ||
          typeof repository.html_url !== "string",
      )
    ) {
      fail(
        "github_repository_verification_invalid",
        "GitHub Repository verification result is invalid",
      );
    }
    const existing = new Map(
      durableCore
        .all(
          `SELECT repository_id, forge_repository_id
           FROM github_repositories
           WHERE connection_id = ?`,
          connection.id,
        )
        .map((row) => {
          if (
            !row ||
            typeof row.repository_id !== "string" ||
            !Number.isSafeInteger(row.forge_repository_id)
          ) {
            throw new TypeError("GitHub Repository identity row is invalid");
          }
          return [row.forge_repository_id, row.repository_id];
        }),
    );
    const records = repositories.map((repository) => {
      const id = existing.get(repository.id) ?? createId();
      if (typeof id !== "string" || id.length === 0) {
        throw new TypeError("createId must return nonempty strings");
      }
      return { id, repository };
    });
    const verifiedAt = timestamp();
    try {
      durableCore.transaction((transaction) => {
        for (const { id, repository } of records) {
          if (existing.has(repository.id)) {
            transaction.run(
              `UPDATE repositories
               SET normalized_url = ?,
                   verified_at = ?,
                   health = 'healthy',
                   health_error_code = NULL,
                   health_error_message = NULL
               WHERE id = ?`,
              repository.clone_url,
              verifiedAt,
              id,
            );
            transaction.run(
              `UPDATE github_repositories
               SET name = ?, api_url = ?, web_url = ?
               WHERE repository_id = ?`,
              repository.full_name,
              repository.api_url,
              repository.html_url,
              id,
            );
          } else {
            transaction.run(
              `INSERT INTO repositories (
                 id, normalized_url, created_at, verified_at
               ) VALUES (?, ?, ?, ?)`,
              id,
              repository.clone_url,
              verifiedAt,
              verifiedAt,
            );
            transaction.run(
              `INSERT INTO github_repositories (
                 repository_id, connection_id, forge_repository_id,
                 name, api_url, web_url
               ) VALUES (?, ?, ?, ?, ?, ?)`,
              id,
              connection.id,
              repository.id,
              repository.full_name,
              repository.api_url,
              repository.html_url,
            );
          }
        }
      });
    } catch (error) {
      if (
        isUniqueConstraintFailure(error, "repositories.normalized_url") ||
        isUniqueConstraintFailure(
          error,
          "github_repositories.connection_id, github_repositories.forge_repository_id",
        )
      ) {
        fail(
          "github_repository_identity_conflict",
          "GitHub Repository identity is already registered",
        );
      }
      throw error;
    }
    const resources = new Map(
      durableCore
        .all(
          `SELECT
             repositories.id,
             repositories.normalized_url,
             repositories.lifecycle,
             repositories.health,
             repositories.health_error_code,
             repositories.health_error_message,
             repositories.verified_at,
             github_repositories.connection_id,
             github_repositories.forge_repository_id,
             github_repositories.name,
             github_repositories.api_url,
             github_repositories.web_url,
             (
               SELECT count(*)
               FROM review_assignment_repositories
               WHERE review_assignment_repositories.repository_id =
                 repositories.id
             ) AS assignment_count
           FROM github_repositories
           JOIN repositories
             ON repositories.id = github_repositories.repository_id
           WHERE github_repositories.connection_id = ?`,
          connection.id,
        )
        .map((row) => {
          if (
            !row ||
            typeof row.id !== "string" ||
            typeof row.normalized_url !== "string" ||
            !["enabled", "disabled", "retired"].includes(
              /** @type {string} */ (row.lifecycle),
            ) ||
            !["healthy", "error"].includes(
              /** @type {string} */ (row.health),
            ) ||
            !Number.isSafeInteger(row.verified_at) ||
            typeof row.connection_id !== "string" ||
            !Number.isSafeInteger(row.forge_repository_id) ||
            typeof row.name !== "string" ||
            typeof row.api_url !== "string" ||
            typeof row.web_url !== "string" ||
            !Number.isSafeInteger(row.assignment_count)
          ) {
            throw new TypeError("GitHub Repository row is invalid");
          }
          return [
            row.forge_repository_id,
            {
              api_url: row.api_url,
              assignment_count: row.assignment_count,
              credential_type: "forge_connection",
              forge_connection_id: row.connection_id,
              forge_repository_id: row.forge_repository_id,
              health: row.health,
              health_error:
                row.health === "error"
                  ? {
                      code: row.health_error_code,
                      message: row.health_error_message,
                    }
                  : null,
              id: row.id,
              lifecycle: row.lifecycle,
              name: row.name,
              provider: "github",
              url: row.normalized_url,
              verified_at: row.verified_at,
              web_url: row.web_url,
            },
          ];
        }),
    );
    return repositoryIds.map((id) => resources.get(id));
  };
}
