import { GitHubConnectionError } from "./github-connection-error.ts";
import { acquireAutomaticEvaluations } from "./github-automatic-evaluation-admission.ts";
import {
  admitAutomaticEvaluations,
  completeAutomaticEvaluationAdmissions,
  releaseAutomaticEvaluationChangesets,
} from "../automatic-evaluation-admission-batch.ts";
import {
  GITHUB_POLL_INTERVAL_MS,
  createGitHubPollingService,
} from "./github-polling.ts";
import { recordGitHubPollingOwningFailure } from "./github-polling-owning-failure.ts";
import { requireStorageReservePause } from "../storage-reserve.ts";
import {
  createStorageReservePollingCore,
  hasStorageReservePollingDependencies,
} from "../storage-reserve-polling-core.ts";
import { createIoDutyScheduler } from "../io-execution-pool.ts";
import { requireCodedError } from "../coded-error.ts";
import { createPollingRunner } from "../forge/polling/runner.ts";

export function createGitHubPollingRunner(
  durableCore: any,
  {
    acquirePullRequestChangeset,
    admitAutomaticEvaluation,
    cipher,
    storageReserve,
    timestamp,
    verifier,
  }: {
    acquirePullRequestChangeset: (input: {
      repositoryId: string;
      pullRequest: any;
    }) => Promise<any>;
    admitAutomaticEvaluation: (
      transaction: any,
      input: {
        changeset: any;
        provider: "github";
        pullRequestNumber: number;
        repositoryId: string;
      },
    ) => any;
    cipher: any;
    storageReserve: {
      assertPollingObservationAdvanceAvailable: () => unknown;
      ioPool: any;
      preparePollingObservationAdvance: () => unknown;
    };
    timestamp: () => number;
    verifier: any;
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
    recordOwningFailure: recordGitHubPollingOwningFailure,
  });
  const preparedBaselines = new WeakMap();
  const preparedBaselineFailures = new WeakMap();
  let timer: ReturnType<typeof setInterval> | null = null;

  function queryDue(now: number) {
    return durableCore.all(
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
    return async function runRow(row: any, baseline: boolean) {
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
        return;
      }
      try {
        const baselineRows = baseline
          ? dueRows.filter(
              (candidate: any) =>
                candidate.connection_id === row.connection_id &&
                candidate.baseline_status !== "complete",
            )
          : [row];
        const input = {
          connection: { ...row, id: row.connection_id },
          credential,
          repositories: baselineRows.map((candidate: any) => ({
            id: candidate.forge_repository_id,
            full_name: candidate.name,
          })),
        };
        const prepared = await polling.prepare(input, {
          baseline,
        });
        const automaticEvaluations: {
          changeset: any;
          pullRequestNumber: number;
          repositoryId: string;
        }[] = [];
        const admissions: { afterCommit: () => void; resource: any }[] = [];
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
          if (baseline) {
            tracking.completedBaselines.add(row.connection_id);
          }
        } finally {
          for (const { changeset } of automaticEvaluations) {
            if (!releaseAttempted.has(changeset)) {
              changeset?.release?.();
            }
          }
        }
      } catch (error) {
        const failure = requireCodedError(error);
        if (failure.code === "application_shutting_down") {
          throw failure;
        }
        if (!(failure instanceof GitHubConnectionError)) {
          polling.recordFailure({
            connectionId: row.connection_id,
            error: new GitHubConnectionError(failure.code, failure.message, {
              cause: failure,
              repositoryId: row.forge_repository_id,
            }),
            forgeRepositoryId: row.forge_repository_id,
          });
          return;
        }
        if (failure.code === "github_polling_conflict") {
          throw failure;
        }
        if (baseline || failure.nextAttemptAt !== undefined) {
          tracking.gatedConnections.add(row.connection_id);
        }
      }
    };
  }

  const { runDue: pollDue } = createPollingRunner({
    queryDue,
    createRun,
    storageReserve,
    timestamp,
  });

  const repositoryVerifier = {
    ...verifier,
    commitPollingBaseline(
      verification: any,
      transaction: any,
      connectionId: string,
    ) {
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
    commitPollingFailure(error: GitHubConnectionError, transaction: any) {
      const commit = preparedBaselineFailures.get(error);
      if (commit && !commit(transaction)) {
        throw new GitHubConnectionError(
          "github_repository_enablement_conflict",
          "GitHub polling changed during Repository enablement",
        );
      }
      preparedBaselineFailures.delete(error);
    },
    async verifyRepositories(
      credential: any,
      installationId: number,
      repositoryIds: number[],
    ) {
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

  async function prepareBaseline(
    credential: any,
    installationId: number,
    verification: any,
  ) {
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

  async function prepareConnectionBaseline(
    credential: any,
    installationId: number,
    {
      includeUnhealthy = false,
      ignoreGate = false,
      deferFailures = false,
    }: {
      includeUnhealthy?: boolean;
      ignoreGate?: boolean;
      deferFailures?: boolean;
    } = {},
  ) {
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
          ${includeUnhealthy ? "" : "AND repositories.health = 'healthy'"}
        ORDER BY forge_repository_id`,
      connection.id,
    );
    return polling.prepare(
      { connection, credential, repositories },
      deferFailures
        ? {
            baseline: true,
            ignoreGate,
            onFailure: () => {},
            recordFailure: false,
          }
        : { baseline: true, ignoreGate },
    );
  }

  function commitConnectionBaseline(
    transaction: any,
    connectionId: string,
    prepared: any,
  ) {
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
      timer = setInterval(schedulePoll.background, GITHUB_POLL_INTERVAL_MS);
      timer.unref();
      schedulePoll.background();
    },
    repositoryVerifier,
    prepareConnectionBaseline,
    runDue: pollDue,
  };
}
