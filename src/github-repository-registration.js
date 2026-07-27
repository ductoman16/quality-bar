import { randomUUID } from "node:crypto";

import { GitHubConnectionError } from "./github-connection-error.js";
import { recordGitHubConnectionVerification } from "./github-connection-verification.js";
import { normalizeGitHubRepositorySelection } from "./github-repository-selection.js";
import {
  readRepositoryResource,
  REPOSITORY_SELECTION,
} from "./repository-resource.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";

const CONNECTION_SCOPED_VERIFICATION_ERRORS = new Set([
  "github_api_request_failed",
  "github_api_response_invalid",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_installation_mismatch",
  "github_installation_scope_invalid",
  "github_permissions_mismatch",
  "github_personal_account_required",
  "github_principal_mismatch",
  "github_private_repository_required",
  "github_repository_enumeration_incomplete",
  "github_repository_identity_invalid",
]);
const REPOSITORY_SCOPED_VERIFICATION_ERRORS = new Set([
  "github_private_git_read_failed",
  "github_repository_api_access_failed",
  "github_repository_git_read_failed",
  "github_repository_selection_unavailable",
]);

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new GitHubConnectionError(code, message);
}

/** @param {any} repository @param {string} principalLogin */
function validRepositoryEvidence(repository, principalLogin) {
  return (
    repository &&
    Number.isSafeInteger(repository.id) &&
    typeof repository.full_name === "string" &&
    repository.full_name.split("/")[1]?.length > 0 &&
    repository.full_name ===
      `${principalLogin}/${repository.full_name.split("/")[1] ?? ""}` &&
    repository.clone_url === `https://github.com/${repository.full_name}.git` &&
    repository.api_url ===
      `https://api.github.com/repos/${repository.full_name}` &&
    repository.html_url === `https://github.com/${repository.full_name}`
  );
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
 *   createVerificationId?: () => string | undefined,
 *   timestamp: () => number,
 *   verifier: {verifyRepositories?: (...parameters: any[]) => Promise<any>}
 * }} dependencies
 */
export function createGitHubRepositorySelector(
  durableCore,
  { cipher, createId, createVerificationId = randomUUID, timestamp, verifier },
) {
  /** @param {unknown} request */
  return async function selectRepositories(
    request,
    trigger = "repository_selection",
  ) {
    const repositoryIds = normalizeGitHubRepositorySelection(request);
    if (!["enablement", "repository_selection"].includes(trigger)) {
      throw new TypeError("GitHub Repository verification trigger is invalid");
    }
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
         github_connections.api_profile,
         github_connections.permissions,
         github_connections.capabilities,
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
      typeof connection.api_profile !== "string" ||
      typeof connection.permissions !== "string" ||
      typeof connection.capabilities !== "string" ||
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
    let verification;
    try {
      verification = await verifier.verifyRepositories(
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
    } catch (error) {
      if (error instanceof GitHubConnectionError) {
        const scope = CONNECTION_SCOPED_VERIFICATION_ERRORS.has(error.code)
          ? "connection"
          : REPOSITORY_SCOPED_VERIFICATION_ERRORS.has(error.code)
            ? "repository"
            : null;
        if (scope) {
          recordGitHubConnectionVerification(durableCore, {
            affectedRepositoryIds: error.affectedRepositoryIds ?? repositoryIds,
            capabilities: null,
            createId: createVerificationId,
            error: {
              code: error.code,
              message: error.message,
              repositoryId: error.repositoryId,
              scope,
            },
            evidence: [],
            id: connection.id,
            permissions: null,
            principal: null,
            profile: connection.api_profile,
            timestamp,
            trigger: /** @type {"enablement" | "repository_selection"} */ (
              trigger
            ),
          });
        }
      }
      if (error instanceof GitHubConnectionError) {
        throw new GitHubConnectionError(error.code, error.message, {
          affectedRepositoryIds: error.affectedRepositoryIds,
          cause: error,
          repositoryId: error.repositoryId,
        });
      }
      throw new TypeError("GitHub Repository verification failed", {
        cause: error,
      });
    }
    const repositories = verification?.repositories;
    const repositoryEvidence = verification?.repositoryEvidence;
    const affectedRepositoryIds = verification?.affectedRepositoryIds;
    const verifiedRepositoryIds = new Set(
      Array.isArray(repositories)
        ? repositories.map((repository) => repository?.id)
        : [],
    );
    if (
      !Array.isArray(repositories) ||
      repositories.length !== repositoryIds.length ||
      verifiedRepositoryIds.size !== repositoryIds.length ||
      repositoryIds.some((id) => !verifiedRepositoryIds.has(id)) ||
      repositories.some(
        (repository) =>
          !validRepositoryEvidence(
            repository,
            /** @type {string} */ (connection.principal_login),
          ),
      ) ||
      !Array.isArray(repositoryEvidence) ||
      repositoryEvidence.length === 0 ||
      new Set(repositoryEvidence.map((repository) => repository?.id)).size !==
        repositoryEvidence.length ||
      repositoryEvidence.some(
        (repository) =>
          !validRepositoryEvidence(
            repository,
            /** @type {string} */ (connection.principal_login),
          ),
      ) ||
      !Array.isArray(affectedRepositoryIds) ||
      affectedRepositoryIds.length === 0 ||
      new Set(affectedRepositoryIds).size !== affectedRepositoryIds.length ||
      affectedRepositoryIds.some(
        (id) =>
          !Number.isSafeInteger(id) ||
          !repositoryEvidence.some((repository) => repository.id === id),
      ) ||
      repositoryIds.some((id) => !affectedRepositoryIds.includes(id)) ||
      JSON.stringify(verification.permissions) !== connection.permissions ||
      JSON.stringify(verification.capabilities) !== connection.capabilities ||
      verification.principal?.id !== connection.principal_id ||
      verification.principal?.login !== connection.principal_login
    ) {
      fail(
        "github_repository_verification_invalid",
        "GitHub Repository verification result is invalid",
      );
    }
    const verifiedAt = recordGitHubConnectionVerification(durableCore, {
      affectedRepositoryIds,
      capabilities: verification.capabilities,
      createId: createVerificationId,
      evidence: repositoryEvidence,
      id: connection.id,
      permissions: verification.permissions,
      principal: verification.principal,
      profile: connection.api_profile,
      timestamp,
      trigger: /** @type {"enablement" | "repository_selection"} */ (trigger),
    });
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
          `${REPOSITORY_SELECTION}
           WHERE github_repositories.connection_id = ?`,
          connection.id,
        )
        .map((row) => {
          const resource = readRepositoryResource(row);
          if (!("forge_repository_id" in resource)) {
            throw new TypeError("GitHub Repository row is invalid");
          }
          return [resource.forge_repository_id, resource];
        }),
    );
    return repositoryIds.map((id) => resources.get(id));
  };
}
