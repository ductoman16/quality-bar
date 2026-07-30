import { GitHubConnectionError } from "./github-connection-error.js";
import {
  acquireAutomaticEvaluations,
  admitAutomaticEvaluations,
  completeAutomaticEvaluationAdmissions,
  releaseAutomaticEvaluationChangesets,
} from "./github-automatic-evaluation-admission.js";
import {
  GITHUB_POLL_INTERVAL_MS,
  createGitHubPollingService,
  isDefinitiveGitHubPollingFailure,
} from "./github-polling.js";
import { requireStorageReservePause } from "./storage-reserve.js";
import {
  createStorageReservePollingCore,
  hasStorageReservePollingDependencies,
} from "./storage-reserve-polling-core.js";
import { createIoDutyScheduler } from "./io-execution-pool.js";

/** @param {any} durableCore @param {{acquirePullRequestChangeset: (input: {repositoryId: string, pullRequest: any}) => Promise<any>, admitAutomaticEvaluation: (transaction: any, input: {changeset: any, pullRequestNumber: number, repositoryId: string}) => any, cipher: any, storageReserve: {assertPollingObservationAdvanceAvailable: () => unknown, ioPool: any, preparePollingObservationAdvance: () => unknown}, timestamp: () => number, verifier: any}} dependencies */
export function createGitHubPollingRunner(
  durableCore,
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    cipher,
    storageReserve,
    timestamp,
    verifier,
  },
) {
  if (
    !hasStorageReservePollingDependencies(durableCore, storageReserve) ||
    typeof cipher?.decrypt !== "function" ||
    typeof storageReserve?.ioPool?.run !== "function" ||
    typeof timestamp !== "function" ||
    typeof verifier?.listPullRequests !== "function" ||
    typeof verifier.verifyRepositories !== "function" ||
    typeof acquirePullRequestChangeset !== "function" ||
    typeof admitAutomaticEvaluation !== "function"
  ) {
    throw new TypeError("GitHub polling runner dependencies are invalid");
  }
  const pollingCore = createStorageReservePollingCore(
    durableCore,
    storageReserve,
  );
  const polling = createGitHubPollingService(pollingCore, {
    fetchPullRequests: ({ connection, credential, repository }) => {
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
  const preparedBaselineFailures = new WeakMap();
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
    storageReserve.preparePollingObservationAdvance();
    running = true;
    try {
      const due = durableCore.all(
        `SELECT github_repository_polls.connection_id, github_repository_polls.forge_repository_id,
              github_connections.app_id, github_connections.app_slug,
              github_connections.installation_id, github_connections.principal_id,
              github_connections.principal_login, github_connection_credentials.encrypted_credential,
              github_repositories.name, github_repositories.repository_id,
              github_repository_polls.baseline_status,
              github_repository_polls.snapshot
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
          const baseline = row.baseline_status !== "complete";
          const prepared = await polling.prepare(input, {
            baseline,
          });
          /** @type {{changeset: any, pullRequestNumber: number, repositoryId: string}[]} */
          const automaticEvaluations = [];
          /** @type {{afterCommit: () => void, resource: any}[]} */
          const admissions = [];
          const releaseAttempted = new Set();
          try {
            if (!baseline) {
              automaticEvaluations.push(
                ...(await acquireAutomaticEvaluations(
                  JSON.parse(row.snapshot),
                  prepared.snapshots[0]?.snapshot,
                  row.repository_id,
                  acquirePullRequestChangeset,
                )),
              );
            }
            const committed = pollingCore.transaction((transaction) => {
              if (
                !polling.commitSuccess(transaction, row.connection_id, prepared)
              ) {
                return false;
              }
              admissions.push(
                ...admitAutomaticEvaluations(
                  transaction,
                  automaticEvaluations,
                  admitAutomaticEvaluation,
                ),
              );
              releaseAutomaticEvaluationChangesets(
                automaticEvaluations,
                releaseAttempted,
              );
              return true;
            });
            if (!committed) {
              throw new GitHubConnectionError(
                "github_polling_conflict",
                "GitHub polling changed during reconciliation",
              );
            }
            completeAutomaticEvaluationAdmissions(admissions);
          } finally {
            for (const { changeset } of automaticEvaluations) {
              if (!releaseAttempted.has(changeset)) {
                changeset?.release?.();
              }
            }
          }
        } catch (error) {
          if (
            !(error instanceof GitHubConnectionError) &&
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
          ) {
            polling.recordFailure({
              connectionId: row.connection_id,
              error: new GitHubConnectionError(error.code, error.message, {
                cause: error,
                repositoryId: row.forge_repository_id,
              }),
              forgeRepositoryId: row.forge_repository_id,
            });
            continue;
          }
          if (!(error instanceof GitHubConnectionError)) {
            throw error;
          }
          if (error.code === "github_polling_conflict") {
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
      if (!polling.commitSuccess(transaction, connectionId, prepared)) {
        throw new GitHubConnectionError(
          "github_repository_enablement_conflict",
          "GitHub polling changed during Repository enablement",
        );
      }
      preparedBaselines.delete(verification);
    },
    /** @param {GitHubConnectionError} error @param {any} transaction */
    commitPollingFailure(error, transaction) {
      const commit = preparedBaselineFailures.get(error);
      if (commit && !commit(transaction)) {
        throw new GitHubConnectionError(
          "github_repository_enablement_conflict",
          "GitHub polling changed during Repository enablement",
        );
      }
      preparedBaselineFailures.delete(error);
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
    storageReserve.preparePollingObservationAdvance();
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
      {
        baseline: true,
        onFailure: (failure, commit) =>
          preparedBaselineFailures.set(failure, commit),
        recordFailure: false,
      },
    );
  }

  /** @param {any} credential @param {number} installationId */
  async function prepareConnectionBaseline(credential, installationId) {
    storageReserve.preparePollingObservationAdvance();
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
    if (!polling.commitSuccess(transaction, connectionId, prepared)) {
      throw new GitHubConnectionError(
        "github_repository_enablement_conflict",
        "GitHub polling changed during Connection enablement",
      );
    }
  }

  const schedulePoll = createIoDutyScheduler(
    storageReserve.ioPool,
    "polling",
    () => pollDue().catch(requireStorageReservePause),
  );

  return {
    commitConnectionBaseline,
    destroy() {
      if (timer !== null) {
        clearInterval(timer);
      }
      timer = null;
      schedulePoll.cancel();
    },
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(schedulePoll, GITHUB_POLL_INTERVAL_MS);
      timer.unref();
      schedulePoll();
    },
    repositoryVerifier,
    prepareConnectionBaseline,
    runDue: pollDue,
  };
}
