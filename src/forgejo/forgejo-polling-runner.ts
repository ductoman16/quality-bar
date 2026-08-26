import {
  FORGEJO_POLL_INTERVAL_MS,
  createForgejoPollingService,
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
} from "./forgejo-polling.ts";
import { requireForgejoPollingCommit } from "./forgejo-polling-conflict.ts";
import { nextForgejoPollingDelay } from "./forgejo-polling-delay.ts";
import { readForgejoPollingGeneration } from "./forgejo-polling-generation.ts";
import {
  StorageReserveError,
  requireStorageReservePause,
} from "../storage-reserve.ts";
import {
  createStorageReservePollingCore,
  hasStorageReservePollingDependencies,
} from "../storage-reserve-polling-core.ts";
import { createIoDutyScheduler } from "../io-execution-pool.ts";
import { createIoDutyTimer } from "../io-duty-timer.ts";
import { requireCodedError } from "../coded-error.ts";
import { reconcileForgejoAutomaticEvaluations } from "./forgejo-automatic-reconciliation.ts";
import { gatesForgejoConnection } from "./forgejo-reconciliation-failure.ts";
import { recordForgejoPollingOwningFailure } from "./forgejo-polling-owning-failure.ts";
import { resetForgejoPollingHealth } from "./forgejo-polling-health-reset.ts";
import { createPollingRunner } from "../forge/polling/runner.ts";
export function createForgejoPollingRunner(
  durableCore: any,
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    cipher,
    clearTimer: cancelTimer = clearTimeout,
    setTimer = setTimeout,
    storageReserve,
    timestamp,
    verifier,
  }: any,
) {
  if (
    !hasStorageReservePollingDependencies(durableCore, storageReserve) ||
    typeof cipher?.decrypt !== "function" ||
    typeof storageReserve?.ioPool?.run !== "function" ||
    typeof timestamp !== "function" ||
    typeof verifier?.listPullRequests !== "function" ||
    typeof acquirePullRequestChangeset !== "function" ||
    typeof admitAutomaticEvaluation !== "function"
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
    recordOwningFailure: recordForgejoPollingOwningFailure,
  });
  let started = false;

  function requireFreshBaseline() {
    durableCore.transaction((transaction: any) => {
      transaction.run(
        "DELETE FROM quality_bar_metadata WHERE key LIKE 'forgejo_poll_gate:%'",
      );
      transaction.run(
        `UPDATE forgejo_repository_polls
            SET baseline_status = 'pending',
                error_code = NULL, error_message = NULL,
                rate_gate_until = NULL, next_attempt_at = 0`,
      );
      resetForgejoPollingHealth(transaction);
    });
  }

  function queryDue(now: number) {
    return durableCore.all(
      `SELECT forgejo_repository_polls.connection_id,
              forgejo_repository_polls.forge_repository_id,
              forgejo_repository_polls.baseline_status,
              forgejo_connections.base_url,
              forgejo_connection_credentials.encrypted_credential,
              forgejo_repositories.name,
              forgejo_repositories.repository_id,
              forgejo_repository_polls.snapshot,
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
      now,
    );
  }

  function createRun({
    dueRows,
    tracking,
  }: {
    dueRows: any[];
    tracking: {
      gatedConnections: Set<any>;
      completedBaselines: Set<any>;
      baselineConnections: Set<any>;
    };
  }) {
    const currentGenerations = new Map();
    return async function runRow(row: any, isBaseline: boolean) {
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
          error: error as Error & { code: string },
          forgeRepositoryId: row.forge_repository_id,
        });
        tracking.gatedConnections.add(row.connection_id);
        return;
      }
      let baseline = false;
      let forgeRepositoryIds = [row.forge_repository_id];
      let attemptedAt;
      try {
        let prepared;
        if (isBaseline) {
          baseline = true;
          const baselineRows = dueRows.filter(
            (candidate: any) =>
              candidate.connection_id === row.connection_id &&
              candidate.baseline_status !== "complete",
          );
          forgeRepositoryIds = baselineRows.map(
            (candidate: any) => candidate.forge_repository_id,
          );
          prepared = await prepareBaseline(
            { base_url: row.base_url, id: row.connection_id },
            token,
            baselineRows.map((candidate: any) => ({
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
        attemptedAt = prepared.attemptedAt;
        if (baseline) {
          const committed = pollingCore.transaction((transaction: any) =>
            polling.commitSuccess(
              transaction,
              row.connection_id,
              prepared,
              generation,
            ),
          );
          requireForgejoPollingCommit(
            committed,
            "Forgejo polling changed during reconciliation",
          );
        } else {
          const reconciliationFailure =
            await reconcileForgejoAutomaticEvaluations({
              pollingCore,
              polling,
              row,
              prepared,
              generation,
              acquirePullRequestChangeset,
              admitAutomaticEvaluation,
            });
          if (
            reconciliationFailure &&
            gatesForgejoConnection(reconciliationFailure)
          ) {
            tracking.gatedConnections.add(row.connection_id);
          }
        }
        currentGenerations.set(row.connection_id, generation + 1);
        if (baseline) {
          tracking.completedBaselines.add(row.connection_id);
        }
      } catch (error) {
        const failure = requireCodedError(error);
        if (
          failure instanceof StorageReserveError ||
          failure.code === "application_shutting_down"
        ) {
          throw failure;
        }
        if (failure.code === "forgejo_polling_conflict") {
          throw failure;
        }
        if (!("attemptedAt" in failure) && Number.isSafeInteger(attemptedAt)) {
          Object.assign(failure, {
            attemptedAt,
            repositoryId: row.forge_repository_id,
          });
        }
        if (
          "attemptedAt" in failure &&
          Number.isSafeInteger(failure.attemptedAt)
        ) {
          const committed = pollingCore.transaction((transaction: any) => {
            return polling.commitFailure(
              transaction,
              row.connection_id,
              forgeRepositoryIds,
              failure as Error & {
                code: string;
                nextAttemptAt?: number;
                rateGateUntil?: number;
                repositoryId?: number;
              },
              Number(failure.attemptedAt),
              baseline,
              generation,
            );
          });
          requireForgejoPollingCommit(
            committed,
            "Forgejo polling changed while recording failure",
          );
          currentGenerations.set(row.connection_id, generation + 1);
          if (
            baseline ||
            (isDefinitiveForgejoPollingFailure(failure as { code: string }) &&
              !isRepositoryOwnedDefinitiveForgejoPollingFailure(
                failure as { code: string; repositoryId?: number },
              ))
          ) {
            tracking.gatedConnections.add(row.connection_id);
          }
        } else {
          polling.recordFailure({
            connectionId: row.connection_id,
            error: failure,
            forgeRepositoryId: row.forge_repository_id,
          });
        }
        if (
          "nextAttemptAt" in failure &&
          Number.isSafeInteger(failure.nextAttemptAt)
        ) {
          tracking.gatedConnections.add(row.connection_id);
        }
      }
    };
  }

  const { runDue } = createPollingRunner({
    queryDue,
    createRun,
    storageReserve,
    timestamp,
  });

  function prepareBaseline(
    connection: { base_url: string; id: string },
    token: string,
    repositories: { full_name: string; id: number }[],
    options?: { ignoreGate?: boolean; recordFailure?: boolean },
  ) {
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
    dutyTimer.schedule(delay);
  }

  const scheduleRun = createIoDutyScheduler(
    storageReserve.ioPool,
    "polling",
    runScheduled,
  );

  const dutyTimer = createIoDutyTimer(scheduleRun, {
    clearTimer: cancelTimer,
    retryDelay: FORGEJO_POLL_INTERVAL_MS,
    setTimer,
  });

  return {
    commitFailure: polling.commitFailure,
    commitBaseline(
      transaction: any,
      connectionId: string,
      prepared: any,
      generation?: number,
    ) {
      storageReserve.assertPollingObservationAdvanceAvailable();
      return polling.commitSuccess(
        transaction,
        connectionId,
        prepared,
        generation,
      );
    },
    destroy() {
      started = false;
      dutyTimer.stop();
      scheduleRun.cancel();
    },
    prepareBaseline,
    requireFreshBaseline,
    runDue,
    start() {
      if (started) {
        return;
      }
      started = true;
      dutyTimer.start(0);
    },
  };
}
