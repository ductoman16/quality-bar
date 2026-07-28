import { GitHubConnectionError } from "./github-connection-error.js";
import { pullRequestSnapshot } from "./github-pull-request-snapshot.js";
export { pullRequestSnapshot } from "./github-pull-request-snapshot.js";

export const GITHUB_POLL_INTERVAL_MS = 60_000;

const DEFINITIVE_FAILURES = new Set([
  "github_api_request_failed",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_connection_credential_undecryptable",
  "github_installation_scope_invalid",
  "github_permissions_mismatch",
  "github_principal_mismatch",
  "github_repository_api_access_failed",
]);

/** @param {{code?: string}} failure */
export function isDefinitiveGitHubPollingFailure(failure) {
  return (
    typeof failure.code === "string" && DEFINITIVE_FAILURES.has(failure.code)
  );
}

/** @param {number} attemptedAt @param {{code?: string, nextAttemptAt?: number}} failure */
export function nextGitHubAttemptAt(attemptedAt, failure) {
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
    throw new TypeError("GitHub polling attempt time is invalid");
  }
  if (isDefinitiveGitHubPollingFailure(failure)) {
    return null;
  }
  return failure.nextAttemptAt && failure.nextAttemptAt > attemptedAt
    ? failure.nextAttemptAt
    : attemptedAt + GITHUB_POLL_INTERVAL_MS;
}

/** @param {unknown} error */
function pollingFailure(error) {
  if (error instanceof GitHubConnectionError) {
    return error;
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new TypeError("GitHub polling failed with a non-Error value");
}

/**
 * Durable GitHub pull-request snapshot reconciliation. This narrow slice only
 * absorbs snapshots; Evaluation admission belongs to its own later boundary.
 *
 * @param {{all: Function, transaction: Function}} durableCore
 * @param {{fetchPullRequests: (input: {connection: any, credential: any, repository: any}) => Promise<unknown>, now?: () => number, recordOwningFailure: (transaction: any, connectionId: string, forgeRepositoryIds: number[], failure: GitHubConnectionError, attemptedAt: number) => void}} options
 */
export function createGitHubPollingService(
  durableCore,
  { fetchPullRequests, now = () => Date.now(), recordOwningFailure },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof fetchPullRequests !== "function" ||
    typeof now !== "function" ||
    typeof recordOwningFailure !== "function"
  ) {
    throw new TypeError("GitHub polling dependencies are invalid");
  }

  function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(
        "now must return a nonnegative safe integer timestamp",
      );
    }
    return value;
  }

  /**
   * @param {{connection: any, credential: any, repositories: any[]}} input
   * @param {{baseline?: boolean}} [options]
   */
  async function prepare(input, { baseline = false } = {}) {
    if (
      !input ||
      typeof input.connection?.id !== "string" ||
      !Array.isArray(input.repositories)
    ) {
      throw new TypeError("GitHub polling input is invalid");
    }
    for (const repository of input.repositories) {
      if (!Number.isSafeInteger(repository?.id) || repository.id <= 0) {
        throw new TypeError("GitHub polling repository is invalid");
      }
    }
    const attemptedAt = timestamp();
    const metadataKey = `github_poll_gate:${input.connection.id}`;
    const registeredIds = new Set(
      durableCore
        .all(
          `SELECT forge_repository_id FROM github_repository_polls
            WHERE connection_id = ?`,
          input.connection.id,
        )
        .map(
          (
            /** @type {{forge_repository_id: number}} */ {
              forge_repository_id: id,
            },
          ) => id,
        ),
    );
    const [storedGate] = durableCore.all(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      metadataKey,
    );
    if (storedGate) {
      let gate;
      try {
        gate = JSON.parse(storedGate.value);
      } catch (cause) {
        throw new TypeError("GitHub polling rate gate is invalid", { cause });
      }
      if (
        !gate ||
        typeof gate.code !== "string" ||
        typeof gate.message !== "string" ||
        (gate.nextAttemptAt !== null &&
          !Number.isSafeInteger(gate.nextAttemptAt)) ||
        (gate.rateGateUntil !== null &&
          !Number.isSafeInteger(gate.rateGateUntil)) ||
        typeof gate.hasUnrepresentedFailureOwner !== "boolean" ||
        (gate.forgeRepositoryId !== null &&
          !Number.isSafeInteger(gate.forgeRepositoryId))
      ) {
        throw new TypeError("GitHub polling rate gate is invalid");
      }
      if (gate.nextAttemptAt !== null && gate.nextAttemptAt > attemptedAt) {
        throw new GitHubConnectionError(gate.code, gate.message, {
          ...(gate.nextAttemptAt === null
            ? {}
            : { nextAttemptAt: gate.nextAttemptAt }),
          ...(gate.forgeRepositoryId === null
            ? {}
            : { repositoryId: gate.forgeRepositoryId }),
        });
      }
      durableCore.transaction((/** @type {any} */ transaction) => {
        transaction.run(
          "DELETE FROM quality_bar_metadata WHERE key = ?",
          metadataKey,
        );
      });
    }
    const [repositoryGate] = durableCore.all(
      `SELECT forge_repository_id, error_code, error_message, rate_gate_until
         FROM github_repository_polls
        WHERE connection_id = ? AND rate_gate_until > ?
        ORDER BY rate_gate_until DESC LIMIT 1`,
      input.connection.id,
      attemptedAt,
    );
    if (repositoryGate) {
      throw new GitHubConnectionError(
        repositoryGate.error_code,
        repositoryGate.error_message,
        {
          nextAttemptAt: repositoryGate.rate_gate_until,
          repositoryId: repositoryGate.forge_repository_id,
        },
      );
    }
    /** @type {{forgeRepositoryId: number, snapshot: unknown[]}[]} */
    const snapshots = [];
    try {
      for (const repository of input.repositories) {
        snapshots.push({
          forgeRepositoryId: repository.id,
          snapshot: pullRequestSnapshot(
            await fetchPullRequests({
              connection: input.connection,
              credential: input.credential,
              repository,
            }),
          ),
        });
      }
    } catch (error) {
      const failure = pollingFailure(error);
      const nextAttemptAt = nextGitHubAttemptAt(attemptedAt, failure);
      const hasUnrepresentedFailureOwner =
        failure.repositoryId === undefined
          ? true
          : !registeredIds.has(failure.repositoryId);
      durableCore.transaction((/** @type {any} */ transaction) => {
        for (const repository of input.repositories) {
          if (failure.repositoryId === undefined) {
            transaction.run(
              `UPDATE github_repository_polls
                  SET rate_gate_until = ?, next_attempt_at = ?
                WHERE connection_id = ? AND forge_repository_id = ?`,
              failure.nextAttemptAt ?? null,
              nextAttemptAt,
              input.connection.id,
              repository.id,
            );
            continue;
          }
          if (repository.id !== failure.repositoryId) {
            continue;
          }
          if (baseline) {
            transaction.run(
              `UPDATE github_repository_polls
                  SET baseline_status = 'error', error_code = ?,
                      error_message = ?, rate_gate_until = ?,
                      next_attempt_at = ?
                WHERE connection_id = ? AND forge_repository_id = ?`,
              failure.code,
              failure.message,
              failure.nextAttemptAt ?? null,
              nextAttemptAt,
              input.connection.id,
              repository.id,
            );
          } else {
            transaction.run(
              `INSERT INTO github_repository_polls (
               connection_id, forge_repository_id, baseline_status,
               last_success_at, error_code, error_message, rate_gate_until,
               next_attempt_at, snapshot
             ) VALUES (?, ?, 'error', NULL, ?, ?, ?, ?, NULL)
             ON CONFLICT (connection_id, forge_repository_id) DO UPDATE SET
               baseline_status = CASE WHEN ? THEN 'error'
                 ELSE github_repository_polls.baseline_status END,
               error_code = excluded.error_code,
               error_message = excluded.error_message,
               rate_gate_until = excluded.rate_gate_until,
               next_attempt_at = excluded.next_attempt_at`,
              input.connection.id,
              repository.id,
              failure.code,
              failure.message,
              failure.nextAttemptAt ?? null,
              nextAttemptAt,
              baseline ? 1 : 0,
            );
          }
        }
        if (baseline || failure.repositoryId === undefined) {
          transaction.run(
            `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
            metadataKey,
            JSON.stringify({
              code: failure.code,
              forgeRepositoryId: failure.repositoryId ?? null,
              hasUnrepresentedFailureOwner,
              message: failure.message,
              nextAttemptAt,
              rateGateUntil: failure.nextAttemptAt ?? null,
            }),
          );
        }
        if (failure.nextAttemptAt !== undefined) {
          transaction.run(
            `UPDATE github_repository_polls
                SET rate_gate_until = ?,
                    next_attempt_at = MAX(next_attempt_at, ?)
              WHERE connection_id = ?`,
            failure.nextAttemptAt,
            nextAttemptAt,
            input.connection.id,
          );
        }
        recordOwningFailure(
          transaction,
          input.connection.id,
          input.repositories.map(({ id }) => id),
          failure,
          attemptedAt,
        );
      });
      throw failure;
    }
    return { completedAt: timestamp(), snapshots };
  }

  /**
   * @param {any} transaction
   * @param {string} connectionId
   * @param {{completedAt: number, snapshots: {forgeRepositoryId: number, snapshot: unknown[]}[]}} prepared
   */
  function commitSuccess(transaction, connectionId, prepared) {
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = ?",
      `github_poll_gate:${connectionId}`,
    );
    for (const { forgeRepositoryId, snapshot } of prepared.snapshots) {
      transaction.run(
        `INSERT INTO github_repository_polls (
           connection_id, forge_repository_id, baseline_status,
           last_success_at, error_code, error_message, rate_gate_until,
           next_attempt_at, snapshot
         ) VALUES (?, ?, 'complete', ?, NULL, NULL, NULL, ?, ?)
         ON CONFLICT (connection_id, forge_repository_id) DO UPDATE SET
           baseline_status = 'complete', last_success_at = excluded.last_success_at,
           error_code = NULL, error_message = NULL, rate_gate_until = NULL,
           next_attempt_at = excluded.next_attempt_at, snapshot = excluded.snapshot`,
        connectionId,
        forgeRepositoryId,
        prepared.completedAt,
        prepared.completedAt + GITHUB_POLL_INTERVAL_MS,
        JSON.stringify(snapshot),
      );
    }
  }

  /** @param {{connection: any, credential: any, repositories: any[]}} input */
  async function reconcile(input) {
    const prepared = await prepare(input);
    durableCore.transaction((/** @type {any} */ transaction) => {
      commitSuccess(transaction, input.connection.id, prepared);
    });
    return prepared.snapshots.map(({ forgeRepositoryId }) => forgeRepositoryId);
  }

  /** @param {{connection: any, credential: any, repositories: any[]}} input */
  async function baseline(input) {
    const prepared = await prepare(input, { baseline: true });
    durableCore.transaction((/** @type {any} */ transaction) => {
      commitSuccess(transaction, input.connection.id, prepared);
    });
    return prepared.snapshots.map(({ forgeRepositoryId }) => forgeRepositoryId);
  }

  /** @param {{connectionId: string, forgeRepositoryId: number, error: GitHubConnectionError}} input */
  function recordFailure({ connectionId, forgeRepositoryId, error }) {
    const attemptedAt = timestamp();
    const nextAttemptAt = nextGitHubAttemptAt(attemptedAt, error);
    durableCore.transaction((/** @type {any} */ transaction) => {
      if (error.repositoryId === undefined) {
        transaction.run(
          `UPDATE github_repository_polls
              SET rate_gate_until = ?, next_attempt_at = ?
            WHERE connection_id = ? AND forge_repository_id = ?`,
          error.nextAttemptAt ?? null,
          nextAttemptAt,
          connectionId,
          forgeRepositoryId,
        );
        transaction.run(
          `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          `github_poll_gate:${connectionId}`,
          JSON.stringify({
            code: error.code,
            forgeRepositoryId: null,
            hasUnrepresentedFailureOwner: true,
            message: error.message,
            nextAttemptAt,
            rateGateUntil: error.nextAttemptAt ?? null,
          }),
        );
      } else {
        transaction.run(
          `UPDATE github_repository_polls
            SET error_code = ?, error_message = ?,
                rate_gate_until = ?, next_attempt_at = ?
          WHERE connection_id = ? AND forge_repository_id = ?`,
          error.code,
          error.message,
          error.nextAttemptAt ?? null,
          nextAttemptAt,
          connectionId,
          forgeRepositoryId,
        );
      }
      recordOwningFailure(
        transaction,
        connectionId,
        [forgeRepositoryId],
        error,
        attemptedAt,
      );
    });
  }

  return {
    baseline,
    commitSuccess,
    prepare,
    reconcile,
    recordFailure,
  };
}
