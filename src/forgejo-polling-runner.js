import {
  FORGEJO_POLL_INTERVAL_MS,
  createForgejoPollingService,
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
} from "./forgejo-polling.js";
import { requireForgejoPollingCommit } from "./forgejo-polling-conflict.js";
import { nextForgejoPollingDelay } from "./forgejo-polling-delay.js";
import { readForgejoPollingGeneration } from "./forgejo-polling-generation.js";
import {
  StorageReserveError,
  requireStorageReservePause,
} from "./storage-reserve.js";
import {
  createStorageReservePollingCore,
  hasStorageReservePollingDependencies,
} from "./storage-reserve-polling-core.js";
import { scheduleIoDuty } from "./io-execution-pool.js";

/** @param {any} durableCore @param {{cipher: any, storageReserve: {assertPollingObservationAdvanceAvailable: () => unknown, preparePollingObservationAdvance: () => unknown}, timestamp: () => number, verifier: any}} dependencies */
export function createForgejoPollingRunner(
  durableCore,
  { cipher, storageReserve, timestamp, verifier },
) {
  if (
    !hasStorageReservePollingDependencies(durableCore, storageReserve) ||
    typeof cipher?.decrypt !== "function" ||
    typeof timestamp !== "function" ||
    typeof verifier?.listPullRequests !== "function"
  ) {
    throw new TypeError("Forgejo polling runner dependencies are invalid");
  }
  const pollingCore = createStorageReservePollingCore(
    durableCore,
    storageReserve,
  );
  const polling = createForgejoPollingService(pollingCore, {
    fetchPullRequests: ({ connection, credential, repository }) =>
      verifier.listPullRequests(
        { baseUrl: connection.base_url, token: credential },
        repository,
      ),
    now: timestamp,
    recordOwningFailure,
  });
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let started = false;
  let running = false;

  function requireFreshBaseline() {
    durableCore.transaction((/** @type {any} */ transaction) => {
      transaction.run(
        "DELETE FROM quality_bar_metadata WHERE key LIKE 'forgejo_poll_gate:%'",
      );
      transaction.run(
        `UPDATE forgejo_repository_polls
            SET baseline_status = 'pending',
                error_code = NULL, error_message = NULL,
                rate_gate_until = NULL, next_attempt_at = 0`,
      );
      transaction.run(
        `UPDATE repositories
            SET health = 'healthy', health_error_code = NULL,
                health_error_message = NULL
          WHERE id IN (SELECT repository_id FROM forgejo_repositories)
            AND health_error_code IN (
              'forgejo_poll_response_invalid',
              'forgejo_repository_api_access_failed',
              'forgejo_repository_permission_denied'
            )`,
      );
      transaction.run(
        `UPDATE forgejo_connections
            SET health = 'healthy'
          WHERE lifecycle = 'enabled'
            AND (
              SELECT error_code
                FROM forgejo_connection_verifications
               WHERE connection_id = forgejo_connections.id
               ORDER BY rowid DESC LIMIT 1
            ) IS NULL`,
      );
    });
  }

  /** @param {any} transaction @param {string} connectionId @param {number[]} forgeRepositoryIds @param {Error & {code: string, repositoryId?: number}} failure @param {number} attemptedAt */
  function recordOwningFailure(
    transaction,
    connectionId,
    forgeRepositoryIds,
    failure,
    attemptedAt,
  ) {
    if (!isDefinitiveForgejoPollingFailure(failure)) {
      return;
    }
    const repositoryFailure = new Set([
      "forgejo_poll_response_invalid",
      "forgejo_repository_api_access_failed",
      "forgejo_repository_permission_denied",
    ]);
    const repositoryId =
      repositoryFailure.has(failure.code) &&
      Number.isSafeInteger(failure.repositoryId) &&
      forgeRepositoryIds.includes(Number(failure.repositoryId))
        ? Number(failure.repositoryId)
        : null;
    if (repositoryId !== null) {
      transaction.run(
        `UPDATE repositories
            SET health = 'error', health_error_code = ?,
                health_error_message = ?, verified_at = ?
          WHERE id = (
            SELECT repository_id FROM forgejo_repositories
             WHERE connection_id = ? AND forge_repository_id = ?
          )`,
        failure.code,
        failure.message,
        attemptedAt,
        connectionId,
        repositoryId,
      );
      return;
    }
    transaction.run(
      "UPDATE forgejo_connections SET health = 'error', verified_at = ? WHERE id = ?",
      attemptedAt,
      connectionId,
    );
  }

  async function runDue() {
    if (running) {
      return;
    }
    storageReserve.preparePollingObservationAdvance();
    running = true;
    try {
      const due = durableCore.all(
        `SELECT forgejo_repository_polls.connection_id,
                forgejo_repository_polls.forge_repository_id,
                forgejo_repository_polls.baseline_status,
                forgejo_connections.base_url,
                forgejo_connection_credentials.encrypted_credential,
                forgejo_repositories.name,
                (
                  SELECT value FROM quality_bar_metadata
                   WHERE key = 'forgejo_poll_generation:' ||
                               forgejo_repository_polls.connection_id
                ) AS poll_generation
           FROM forgejo_repository_polls
           JOIN forgejo_connections
             ON forgejo_connections.id = forgejo_repository_polls.connection_id
           JOIN forgejo_connection_credentials
             ON forgejo_connection_credentials.connection_id = forgejo_connections.id
           JOIN forgejo_repositories
             ON forgejo_repositories.connection_id = forgejo_repository_polls.connection_id
            AND forgejo_repositories.forge_repository_id =
                forgejo_repository_polls.forge_repository_id
           JOIN repositories
             ON repositories.id = forgejo_repositories.repository_id
          WHERE forgejo_repository_polls.next_attempt_at <= ?
            AND forgejo_connections.lifecycle = 'enabled'
            AND forgejo_connections.health = 'healthy'
            AND repositories.lifecycle = 'enabled'
            AND repositories.health = 'healthy'
          ORDER BY forgejo_repository_polls.connection_id,
                   forgejo_repository_polls.forge_repository_id`,
        timestamp(),
      );
      const gatedConnections = new Set();
      const currentGenerations = new Map();
      const baselineConnections = new Set(
        due
          .filter(
            (/** @type {any} */ row) => row.baseline_status !== "complete",
          )
          .map((/** @type {any} */ row) => row.connection_id),
      );
      const completedBaselines = new Set();
      for (const row of due) {
        if (gatedConnections.has(row.connection_id)) {
          continue;
        }
        if (
          baselineConnections.has(row.connection_id) &&
          completedBaselines.has(row.connection_id)
        ) {
          continue;
        }
        const generation =
          currentGenerations.get(row.connection_id) ??
          readForgejoPollingGeneration(row.poll_generation);
        let token;
        try {
          token = cipher.decrypt(row.connection_id, row.encrypted_credential);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          polling.recordFailure({
            connectionId: row.connection_id,
            error: /** @type {Error & {code: string}} */ (error),
            forgeRepositoryId: row.forge_repository_id,
          });
          gatedConnections.add(row.connection_id);
          continue;
        }
        let baseline = false;
        let forgeRepositoryIds = [row.forge_repository_id];
        try {
          let prepared;
          if (baselineConnections.has(row.connection_id)) {
            baseline = true;
            const baselineRows = due.filter(
              (/** @type {any} */ candidate) =>
                candidate.connection_id === row.connection_id &&
                candidate.baseline_status !== "complete",
            );
            forgeRepositoryIds = baselineRows.map(
              (/** @type {any} */ candidate) => candidate.forge_repository_id,
            );
            prepared = await prepareBaseline(
              { base_url: row.base_url, id: row.connection_id },
              token,
              baselineRows.map((/** @type {any} */ candidate) => ({
                full_name: candidate.name,
                id: candidate.forge_repository_id,
              })),
              { recordFailure: false },
            );
          } else {
            prepared = await polling.prepare(
              {
                connection: {
                  base_url: row.base_url,
                  id: row.connection_id,
                },
                credential: token,
                repositories: [
                  {
                    full_name: row.name,
                    id: row.forge_repository_id,
                  },
                ],
              },
              { recordFailure: false },
            );
          }
          const committed = pollingCore.transaction(
            (/** @type {any} */ transaction) => {
              return polling.commitSuccess(
                transaction,
                row.connection_id,
                prepared,
                generation,
              );
            },
          );
          requireForgejoPollingCommit(
            committed,
            "Forgejo polling changed during reconciliation",
          );
          currentGenerations.set(row.connection_id, generation + 1);
          if (baseline) {
            completedBaselines.add(row.connection_id);
          }
        } catch (error) {
          if (error instanceof StorageReserveError) {
            throw error;
          }
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          if (error.code === "forgejo_polling_conflict") {
            throw error;
          }
          if (
            "attemptedAt" in error &&
            Number.isSafeInteger(error.attemptedAt)
          ) {
            const committed = pollingCore.transaction(
              (/** @type {any} */ transaction) => {
                return polling.commitFailure(
                  transaction,
                  row.connection_id,
                  forgeRepositoryIds,
                  /** @type {Error & {code: string, nextAttemptAt?: number, rateGateUntil?: number, repositoryId?: number}} */ (
                    error
                  ),
                  Number(error.attemptedAt),
                  baseline,
                  generation,
                );
              },
            );
            requireForgejoPollingCommit(
              committed,
              "Forgejo polling changed while recording failure",
            );
            currentGenerations.set(row.connection_id, generation + 1);
            if (
              baseline ||
              (isDefinitiveForgejoPollingFailure(
                /** @type {{code: string}} */ (error),
              ) &&
                !isRepositoryOwnedDefinitiveForgejoPollingFailure(
                  /** @type {{code: string, repositoryId?: number}} */ (error),
                ))
            ) {
              gatedConnections.add(row.connection_id);
            }
          }
          if (
            "nextAttemptAt" in error &&
            Number.isSafeInteger(error.nextAttemptAt)
          ) {
            gatedConnections.add(row.connection_id);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  /**
   * @param {{base_url: string, id: string}} connection
   * @param {string} token
   * @param {{full_name: string, id: number}[]} repositories
   * @param {{ignoreGate?: boolean, recordFailure?: boolean}} [options]
   */
  function prepareBaseline(connection, token, repositories, options) {
    storageReserve.preparePollingObservationAdvance();
    return polling.prepare(
      {
        connection,
        credential: token,
        repositories,
      },
      {
        baseline: true,
        ignoreGate: options?.ignoreGate ?? false,
        recordFailure: options?.recordFailure ?? true,
      },
    );
  }

  async function runScheduled() {
    let delay = FORGEJO_POLL_INTERVAL_MS;
    try {
      await runDue();
      delay = nextForgejoPollingDelay(durableCore, timestamp);
    } catch (error) {
      requireStorageReservePause(error);
    }
    if (!started) {
      return;
    }
    timer = setTimeout(scheduleRun, delay);
    timer.unref();
  }

  const scheduleRun = scheduleIoDuty("polling", runScheduled);

  return {
    commitFailure: polling.commitFailure,
    /** @param {any} transaction @param {string} connectionId @param {any} prepared @param {number} [generation] */
    commitBaseline(transaction, connectionId, prepared, generation) {
      storageReserve.assertPollingObservationAdvanceAvailable();
      return polling.commitSuccess(
        transaction,
        connectionId,
        prepared,
        generation,
      );
    },
    destroy() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = null;
      started = false;
    },
    prepareBaseline,
    requireFreshBaseline,
    runDue,
    start() {
      if (started) {
        return;
      }
      started = true;
      timer = setTimeout(scheduleRun, 0);
      timer.unref();
    },
  };
}
