import { randomUUID } from "node:crypto";

import { GitHubConnectionError } from "./github-connection-error.js";
import { recordGitHubConnectionVerification } from "./github-connection-verification.js";
import { normalizeGitHubRepositorySelection } from "./github-repository-selection.js";
import {
  createGitHubRepositorySelectionCommit,
  requireCurrentGitHubRepositoryConnection,
  requireCurrentGitHubRepositories,
} from "./github-repository-selection-commit.js";
import { readGitHubRepositorySelectionSnapshot } from "./github-repository-selection-snapshot.js";
import {
  validGitHubRepositoryEvidence,
  verifiedGitHubRepositoryEvidence,
} from "./github-verification-error.js";
import { githubVerificationErrorScope } from "./github-verification-scope.js";
import {
  readRepositoryResource,
  REPOSITORY_SELECTION,
} from "../repository/repository-resource.js";
import { isUniqueConstraintFailure } from "../sqlite-error.js";

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
 *   cipher: {decrypt(connection: {appId: number, id: string}, encrypted: string): {client_id: string | null, installation_id: number, pem: string}},
 *   createId: () => string | undefined,
 *   createVerificationId?: () => string | undefined,
 *   timestamp: () => number,
 *   verifier: {commitPollingBaseline: (verification: any, transaction: any, connectionId: string) => void, commitPollingFailure: (error: GitHubConnectionError, transaction: any, connectionId: string) => void, verifyRepositories?: (...parameters: any[]) => Promise<any>}
 * }} dependencies
 */
export function createGitHubRepositorySelector(
  durableCore,
  { cipher, createId, createVerificationId = randomUUID, timestamp, verifier },
) {
  if (typeof verifier.commitPollingBaseline !== "function") {
    throw new TypeError("GitHub polling baseline dependency is unavailable");
  }
  if (typeof verifier.commitPollingFailure !== "function") {
    throw new TypeError("GitHub polling failure dependency is unavailable");
  }
  /**
   * @param {unknown} request
   * @param {"enablement" | "repository_selection"} [trigger]
   * @param {{deferCommit?: boolean}} [options]
   */
  return async function selectRepositories(
    request,
    trigger = "repository_selection",
    { deferCommit = false } = {},
  ) {
    if (!["enablement", "repository_selection"].includes(trigger)) {
      throw new TypeError("GitHub Repository verification trigger is invalid");
    }
    const { repositoryIds, requestId } = normalizeGitHubRepositorySelection(
      request,
      trigger === "repository_selection",
    );
    if (typeof verifier.verifyRepositories !== "function") {
      throw new TypeError(
        "GitHub verifier must provide Repository verification",
      );
    }
    const createAttemptId =
      requestId === undefined ? createVerificationId : () => requestId;
    const { connection, existing } =
      readGitHubRepositorySelectionSnapshot(durableCore);
    const connectionId = connection.id;
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
      /** @type {((transaction: any) => void) | undefined} */
      let failureCommit;
      if (error instanceof GitHubConnectionError) {
        const scope = githubVerificationErrorScope(error.code);
        if (scope) {
          const evidence = verifiedGitHubRepositoryEvidence(
            error,
            connection.principal_login,
          );
          const completedEnumeration = evidence.length > 0;
          const failure = recordGitHubConnectionVerification(
            durableCore,
            {
              affectedRepositoryIds:
                error.affectedRepositoryIds ?? repositoryIds,
              capabilities: completedEnumeration
                ? JSON.parse(connection.capabilities)
                : null,
              completedRepositoryIds: error.completedRepositoryIds,
              createId: createAttemptId,
              error: {
                code: error.code,
                message: error.message,
                repositoryId: error.repositoryId,
                scope,
              },
              evidence,
              id: connection.id,
              permissions: completedEnumeration
                ? JSON.parse(connection.permissions)
                : null,
              principal: completedEnumeration
                ? {
                    id: /** @type {number} */ (connection.principal_id),
                    login: connection.principal_login,
                  }
                : null,
              profile: completedEnumeration ? connection.api_profile : null,
              timestamp,
              trigger: /** @type {"enablement" | "repository_selection"} */ (
                trigger
              ),
            },
            { defer: true },
          );
          failureCommit = (transaction) => {
            requireCurrentGitHubRepositoryConnection(
              transaction,
              connection,
              connectionId,
            );
            requireCurrentGitHubRepositories(
              transaction,
              connectionId,
              existing,
              [
                ...(error.affectedRepositoryIds ?? repositoryIds),
                ...(error.completedRepositoryIds ?? []),
              ],
            );
            verifier.commitPollingFailure(error, transaction, connectionId);
            failure.commit(transaction);
          };
          if (!deferCommit) {
            durableCore.transaction(failureCommit);
            failureCommit = undefined;
          }
        }
      }
      if (error instanceof GitHubConnectionError) {
        throw new GitHubConnectionError(error.code, error.message, {
          affectedRepositoryIds: error.affectedRepositoryIds,
          cause: error,
          commit: failureCommit,
          completedRepositoryIds: error.completedRepositoryIds,
          repositoryEvidence: error.repositoryEvidence,
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
          !validGitHubRepositoryEvidence(
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
          !validGitHubRepositoryEvidence(
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
    const verified = recordGitHubConnectionVerification(
      durableCore,
      {
        affectedRepositoryIds,
        capabilities: verification.capabilities,
        createId: createAttemptId,
        evidence: repositoryEvidence,
        id: connection.id,
        permissions: verification.permissions,
        principal: verification.principal,
        profile: connection.api_profile,
        timestamp,
        trigger,
      },
      { defer: true },
    );
    const selectedRepositoryIds = new Set(repositoryIds);
    const currentRepositoryIds = new Set(
      repositoryEvidence.map((repository) => repository.id),
    );
    /** @type {ReturnType<typeof recordGitHubConnectionVerification>[]} */
    const removedVerifications = [];
    for (const forgeRepositoryId of existing.keys()) {
      if (!currentRepositoryIds.has(forgeRepositoryId)) {
        removedVerifications.push(
          recordGitHubConnectionVerification(
            durableCore,
            {
              affectedRepositoryIds: [forgeRepositoryId],
              capabilities: verification.capabilities,
              createId: createVerificationId,
              error: {
                code: "github_repository_selection_unavailable",
                message:
                  "GitHub Repository is no longer accessible to the Connection",
                repositoryId: forgeRepositoryId,
                scope: "repository",
              },
              evidence: repositoryEvidence,
              id: connection.id,
              permissions: verification.permissions,
              principal: verification.principal,
              profile: connection.api_profile,
              timestamp,
              trigger,
            },
            { defer: true },
          ),
        );
      }
    }
    const records = repositoryEvidence
      .filter(
        (repository) =>
          selectedRepositoryIds.has(repository.id) ||
          existing.has(repository.id),
      )
      .map((repository) => {
        const existingRepository = existing.get(repository.id);
        const id = existingRepository?.id ?? createId();
        if (typeof id !== "string" || id.length === 0) {
          throw new TypeError("createId must return nonempty strings");
        }
        return { existingRepository, id, repository };
      });
    const commitSelection = createGitHubRepositorySelectionCommit({
      affectedRepositoryIds,
      connection,
      connectionId,
      deferCommit,
      existing,
      records,
      removedVerifications,
      verification,
      verified,
      verifier,
    });
    if (deferCommit) {
      return { commit: commitSelection };
    }
    try {
      durableCore.transaction(commitSelection);
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
