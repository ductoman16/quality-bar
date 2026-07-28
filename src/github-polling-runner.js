import { GitHubConnectionError } from "./github-connection-error.js";
import {
  GITHUB_POLL_INTERVAL_MS,
  createGitHubPollingService,
  isDefinitiveGitHubPollingFailure,
} from "./github-polling.js";
import { StorageReserveError } from "./storage-reserve.js";

/** @param {any} durableCore @param {{cipher: any, storageReserve: {assertPollingObservationAdvanceAvailable: () => unknown}, timestamp: () => number, verifier: any}} dependencies */
export function createGitHubPollingRunner(
  durableCore,
  { cipher, storageReserve, timestamp, verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof storageReserve?.assertPollingObservationAdvanceAvailable !==
      "function" ||
    typeof timestamp !== "function" ||
    typeof verifier?.listPullRequests !== "function" ||
    typeof verifier.verifyRepositories !== "function"
  ) {
    throw new TypeError("GitHub polling runner dependencies are invalid");
  }
  const polling = createGitHubPollingService(durableCore, {
    fetchPullRequests: ({ connection, credential, repository }) => {
      if (typeof verifier.listPullRequests !== "function") {
        throw new TypeError(
          "GitHub verifier must provide pull request polling",
        );
      }
      return verifier.listPullRequests(
        {
          app_id: connection.app_id,
          app_slug: connection.app_slug,
          client_id: credential.client_id,
          owner: {
            id: connection.principal_id,
            login: connection.principal_login,
            type: "User",
          },
          pem: credential.pem,
        },
        connection.installation_id,
        repository,
      );
    },
    now: timestamp,
    recordOwningFailure,
  });
  const preparedBaselines = new WeakMap();
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;

  /** @param {any} transaction @param {string} connectionId @param {number[]} forgeRepositoryIds @param {GitHubConnectionError} failure @param {number} attemptedAt */
  function recordOwningFailure(
    transaction,
    connectionId,
    forgeRepositoryIds,
    failure,
    attemptedAt,
  ) {
    if (!isDefinitiveGitHubPollingFailure(failure)) {
      return;
    }
    const repositoryId = Number.isSafeInteger(failure.repositoryId)
      ? /** @type {number} */ (failure.repositoryId)
      : failure.code === "github_repository_api_access_failed" &&
          forgeRepositoryIds.length === 1
        ? forgeRepositoryIds[0]
        : null;
    if (repositoryId !== null && forgeRepositoryIds.includes(repositoryId)) {
      transaction.run(
        `UPDATE repositories
              SET health = 'error', health_error_code = ?,
                  health_error_message = ?, verified_at = ?
            WHERE id = (
              SELECT repository_id FROM github_repositories
               WHERE connection_id = ? AND forge_repository_id = ?
            )`,
        failure.code,
        failure.message,
        attemptedAt,
        connectionId,
        repositoryId,
      );
    } else {
      transaction.run(
        `UPDATE github_connections
              SET health = 'error', health_error_code = ?,
                  health_error_message = ?, verified_at = ?
            WHERE id = ?`,
        failure.code,
        failure.message,
        attemptedAt,
        connectionId,
      );
    }
  }

  async function pollDue() {
    if (running) {
      return;
    }
    storageReserve.assertPollingObservationAdvanceAvailable();
    running = true;
    try {
      const due = durableCore.all(
        `SELECT github_repository_polls.connection_id, github_repository_polls.forge_repository_id,
              github_connections.app_id, github_connections.app_slug,
              github_connections.installation_id, github_connections.principal_id,
              github_connections.principal_login, github_connection_credentials.encrypted_credential,
              github_repositories.name, github_repository_polls.baseline_status
         FROM github_repository_polls
         JOIN github_connections ON github_connections.id = github_repository_polls.connection_id
         JOIN github_connection_credentials ON github_connection_credentials.connection_id = github_connections.id
         JOIN github_repositories ON github_repositories.connection_id = github_repository_polls.connection_id
          AND github_repositories.forge_repository_id = github_repository_polls.forge_repository_id
         JOIN repositories ON repositories.id = github_repositories.repository_id
        WHERE github_repository_polls.next_attempt_at <= ?
          AND github_connections.lifecycle = 'enabled'
          AND github_connections.health = 'healthy'
          AND repositories.lifecycle = 'enabled'
          AND repositories.health = 'healthy'
        ORDER BY github_repository_polls.connection_id,
                 github_repository_polls.forge_repository_id`,
        timestamp(),
      );
      const gatedConnections = new Set();
      for (const row of due) {
        if (gatedConnections.has(row.connection_id)) {
          continue;
        }
        let credential;
        try {
          credential = cipher.decrypt(
            { appId: row.app_id, id: row.connection_id },
            row.encrypted_credential,
          );
        } catch (error) {
          if (!(error instanceof Error)) {
            throw new TypeError(
              "GitHub credential decryption failed with a non-Error value",
            );
          }
          const failure =
            error instanceof GitHubConnectionError
              ? error
              : "code" in error && typeof error.code === "string"
                ? new GitHubConnectionError(error.code, error.message, {
                    cause: error,
                  })
                : null;
          if (!failure) {
            throw error;
          }
          polling.recordFailure({
            connectionId: row.connection_id,
            error: failure,
            forgeRepositoryId: row.forge_repository_id,
          });
          continue;
        }
        try {
          const input = {
            connection: { ...row, id: row.connection_id },
            credential,
            repositories: [
              { id: row.forge_repository_id, full_name: row.name },
            ],
          };
          const prepared = await polling.prepare(input, {
            baseline: row.baseline_status !== "complete",
          });
          storageReserve.assertPollingObservationAdvanceAvailable();
          durableCore.transaction((/** @type {any} */ transaction) => {
            polling.commitSuccess(transaction, row.connection_id, prepared);
          });
        } catch (error) {
          if (!(error instanceof GitHubConnectionError)) {
            throw error;
          }
          if (error.nextAttemptAt !== undefined) {
            gatedConnections.add(row.connection_id);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  const repositoryVerifier = {
    ...verifier,
    /** @param {any} verification @param {any} transaction @param {string} connectionId */
    commitPollingBaseline(verification, transaction, connectionId) {
      const prepared = preparedBaselines.get(verification);
      if (!prepared) {
        throw new TypeError("GitHub polling baseline is unavailable");
      }
      storageReserve.assertPollingObservationAdvanceAvailable();
      polling.commitSuccess(transaction, connectionId, prepared);
      preparedBaselines.delete(verification);
    },
    /** @param {any} credential @param {number} installationId @param {number[]} repositoryIds */
    async verifyRepositories(credential, installationId, repositoryIds) {
      const verification = await verifier.verifyRepositories(
        credential,
        installationId,
        repositoryIds,
      );
      const prepared = await prepareBaseline(
        credential,
        installationId,
        verification,
      );
      if (!verification || typeof verification !== "object") {
        throw new TypeError("GitHub polling baseline input is invalid");
      }
      preparedBaselines.set(verification, prepared);
      return verification;
    },
  };

  /** @param {any} credential @param {number} installationId @param {any} verification */
  async function prepareBaseline(credential, installationId, verification) {
    storageReserve.assertPollingObservationAdvanceAvailable();
    const [connection] = durableCore.all(
      `SELECT id, app_id, app_slug, installation_id, principal_id, principal_login
         FROM github_connections WHERE installation_id = ?`,
      installationId,
    );
    if (!connection || !Array.isArray(verification?.repositories)) {
      throw new TypeError("GitHub polling baseline input is invalid");
    }
    return polling.prepare(
      { connection, credential, repositories: verification.repositories },
      { baseline: true },
    );
  }

  /** @param {any} credential @param {number} installationId */
  async function prepareConnectionBaseline(credential, installationId) {
    storageReserve.assertPollingObservationAdvanceAvailable();
    const [connection] = durableCore.all(
      `SELECT id, app_id, app_slug, installation_id, principal_id, principal_login
         FROM github_connections WHERE installation_id = ?`,
      installationId,
    );
    if (!connection) {
      throw new TypeError("GitHub polling baseline input is invalid");
    }
    const repositories = durableCore.all(
      `SELECT github_repositories.forge_repository_id AS id,
              github_repositories.name AS full_name
         FROM github_repositories
         JOIN repositories
           ON repositories.id = github_repositories.repository_id
        WHERE github_repositories.connection_id = ?
          AND repositories.lifecycle = 'enabled'
          AND repositories.health = 'healthy'
        ORDER BY forge_repository_id`,
      connection.id,
    );
    return polling.prepare(
      { connection, credential, repositories },
      { baseline: true },
    );
  }

  /** @param {any} transaction @param {string} connectionId @param {any} prepared */
  function commitConnectionBaseline(transaction, connectionId, prepared) {
    if (!prepared) {
      throw new TypeError("GitHub polling baseline is unavailable");
    }
    storageReserve.assertPollingObservationAdvanceAvailable();
    polling.commitSuccess(transaction, connectionId, prepared);
  }

  async function pollScheduled() {
    try {
      await pollDue();
    } catch (error) {
      if (!(error instanceof StorageReserveError)) {
        throw error;
      }
    }
  }

  return {
    commitConnectionBaseline,
    destroy() {
      if (timer !== null) {
        clearInterval(timer);
      }
    },
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => void pollScheduled(), GITHUB_POLL_INTERVAL_MS);
      timer.unref();
      void pollScheduled();
    },
    repositoryVerifier,
    prepareConnectionBaseline,
    runDue: pollDue,
  };
}
