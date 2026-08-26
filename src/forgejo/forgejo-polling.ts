import {
  FORGEJO_POLL_INTERVAL_MS,
  isRepositoryOwnedForgejoPollingFailure,
  nextForgejoAttemptAt,
} from "./forgejo-polling-failure.ts";
import { forgejoFailureRepositoryIds } from "./forgejo-failure.ts";
export {
  FORGEJO_POLL_INTERVAL_MS,
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
  nextForgejoAttemptAt,
} from "./forgejo-polling-failure.ts";

function codedFailure(error: unknown) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error as Error & {
      code: string;
      nextAttemptAt?: number;
      rateGateUntil?: number;
      repositoryId?: number;
    };
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new TypeError("Forgejo polling failed with a non-Error value");
}

export function readForgejoPollingGeneration(
  transaction: any,
  connectionId: string,
) {
  const parameters = [
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    `forgejo_poll_generation:${connectionId}`,
  ];
  const row =
    typeof transaction.get === "function"
      ? transaction.get(...parameters)
      : transaction.all(...parameters)[0];
  if (!row) {
    return 0;
  }
  if (
    typeof row.value !== "string" ||
    !/^(0|[1-9]\d*)$/u.test(row.value) ||
    !Number.isSafeInteger(Number(row.value))
  ) {
    throw new TypeError("Forgejo polling generation is invalid");
  }
  return Number(row.value);
}

export function claimForgejoPollingGeneration(
  transaction: any,
  connectionId: string,
  expectedGeneration: number | undefined,
) {
  const current = readForgejoPollingGeneration(transaction, connectionId);
  if (expectedGeneration !== undefined && current !== expectedGeneration) {
    return false;
  }
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("Forgejo polling generation is exhausted");
  }
  transaction.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    `forgejo_poll_generation:${connectionId}`,
    String(current + 1),
  );
  return true;
}

export function createForgejoPollingService(
  durableCore: { all: Function; transaction: Function },
  {
    fetchPullRequests,
    now = () => Date.now(),
    recordOwningFailure,
  }: {
    fetchPullRequests: (input: {
      connection: any;
      credential: any;
      repository: any;
    }) => Promise<unknown[]>;
    now?: () => number;
    recordOwningFailure: (
      transaction: any,
      connectionId: string,
      forgeRepositoryIds: number[],
      failure: Error & { code: string; repositoryId?: number },
      attemptedAt: number,
    ) => void;
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof fetchPullRequests !== "function" ||
    typeof now !== "function" ||
    typeof recordOwningFailure !== "function"
  ) {
    throw new TypeError("Forgejo polling dependencies are invalid");
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

  function requirePermittedAttempt(connectionId: string, attemptedAt: number) {
    const [gate] = durableCore.all(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      `forgejo_poll_gate:${connectionId}`,
    );
    if (!gate) {
      return;
    }
    let value;
    try {
      value = JSON.parse(gate.value);
    } catch (cause) {
      throw new TypeError("Forgejo polling gate is invalid", { cause });
    }
    if (
      !value ||
      typeof value.code !== "string" ||
      typeof value.message !== "string" ||
      (value.nextAttemptAt !== null &&
        !Number.isSafeInteger(value.nextAttemptAt)) ||
      (value.rateGateUntil !== null &&
        !Number.isSafeInteger(value.rateGateUntil)) ||
      (value.repositoryId !== null && !Number.isSafeInteger(value.repositoryId))
    ) {
      throw new TypeError("Forgejo polling gate is invalid");
    }
    if (value.nextAttemptAt !== null && value.nextAttemptAt > attemptedAt) {
      throw Object.assign(new Error(value.message), {
        code: value.code,
        nextAttemptAt: value.nextAttemptAt,
        ...(value.repositoryId === null
          ? {}
          : { repositoryId: value.repositoryId }),
      });
    }
  }

  async function prepare(
    input: { connection: any; credential: any; repositories: any[] },
    {
      baseline = false,
      ignoreGate = false,
      recordFailure = true,
    }: {
      baseline?: boolean;
      ignoreGate?: boolean;
      recordFailure?: boolean;
    } = {},
  ) {
    if (
      typeof input?.connection?.id !== "string" ||
      !Array.isArray(input.repositories) ||
      input.repositories.some(
        (repository) =>
          !Number.isSafeInteger(repository?.id) ||
          repository.id <= 0 ||
          typeof repository.full_name !== "string" ||
          repository.full_name.length === 0,
      )
    ) {
      throw new TypeError("Forgejo polling input is invalid");
    }
    const attemptedAt = timestamp();
    const expectedGeneration = readForgejoPollingGeneration(
      durableCore,
      input.connection.id,
    );
    if (!ignoreGate) {
      requirePermittedAttempt(input.connection.id, attemptedAt);
    }
    const snapshots = [];
    try {
      for (const repository of input.repositories) {
        const snapshot = await fetchPullRequests({
          connection: input.connection,
          credential: input.credential,
          repository,
        });
        if (!Array.isArray(snapshot)) {
          throw Object.assign(
            new Error("Forgejo pull-request polling response is invalid"),
            {
              code: "forgejo_poll_response_invalid",
              repositoryId: repository.id,
            },
          );
        }
        snapshots.push({
          forgeRepositoryId: repository.id,
          snapshot,
        });
      }
    } catch (error) {
      const failure = codedFailure(error);
      Object.assign(failure, { attemptedAt });
      if (recordFailure) {
        const committed = recordFailureState(
          input.connection.id,
          input.repositories.map(({ id }) => id),
          failure,
          attemptedAt,
          baseline,
          expectedGeneration,
        );
        if (!committed) {
          throw Object.assign(
            new Error("Forgejo polling changed while recording failure"),
            { code: "forgejo_polling_conflict" },
          );
        }
      }
      throw failure;
    }
    return {
      attemptedAt,
      completedAt: timestamp(),
      expectedGeneration,
      snapshots,
    };
  }

  function recordFailureState(
    connectionId: string,
    forgeRepositoryIds: number[],
    failure: Error & {
      code: string;
      nextAttemptAt?: number;
      rateGateUntil?: number;
      repositoryId?: number;
      repositoryIds?: number[];
    },
    attemptedAt: number,
    baseline: boolean,
    expectedGeneration?: number,
  ) {
    return durableCore.transaction((transaction: any) => {
      return commitFailure(
        transaction,
        connectionId,
        forgeRepositoryIds,
        failure,
        attemptedAt,
        baseline,
        expectedGeneration,
      );
    });
  }

  function commitFailure(
    transaction: any,
    connectionId: string,
    forgeRepositoryIds: number[],
    failure: Error & {
      code: string;
      nextAttemptAt?: number;
      rateGateUntil?: number;
      repositoryId?: number;
    },
    attemptedAt: number,
    baseline: boolean,
    expectedGeneration?: number,
    beforeOwningFailure?: () => void,
  ) {
    if (
      !claimForgejoPollingGeneration(
        transaction,
        connectionId,
        expectedGeneration,
      )
    ) {
      return false;
    }
    const nextAttemptAt = nextForgejoAttemptAt(attemptedAt, failure);
    const failureRepositoryIds = forgejoFailureRepositoryIds(failure);
    for (const forgeRepositoryId of forgeRepositoryIds) {
      if (
        failureRepositoryIds.length > 0 &&
        !failureRepositoryIds.includes(forgeRepositoryId)
      ) {
        if (baseline) {
          transaction.run(
            `UPDATE forgejo_repository_polls
                SET next_attempt_at = ?
              WHERE connection_id = ? AND forge_repository_id = ?`,
            nextAttemptAt ?? Number.MAX_SAFE_INTEGER,
            connectionId,
            forgeRepositoryId,
          );
        }
        continue;
      }
      transaction.run(
        `UPDATE forgejo_repository_polls
            SET baseline_status = CASE WHEN ? THEN 'error'
                  ELSE baseline_status END,
                error_code = ?, error_message = ?,
                rate_gate_until = ?, next_attempt_at = ?
          WHERE connection_id = ? AND forge_repository_id = ?`,
        baseline ? 1 : 0,
        failure.code,
        failure.message,
        failure.rateGateUntil ?? null,
        nextAttemptAt,
        connectionId,
        forgeRepositoryId,
      );
    }
    const repositoryOwnedFailure =
      isRepositoryOwnedForgejoPollingFailure(failure);
    if (!baseline && !repositoryOwnedFailure) {
      transaction.run(
        `UPDATE forgejo_repository_polls
            SET next_attempt_at = ?
          WHERE connection_id = ?`,
        nextAttemptAt,
        connectionId,
      );
    }
    if (!repositoryOwnedFailure) {
      transaction.run(
        `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        `forgejo_poll_gate:${connectionId}`,
        JSON.stringify({
          code: failure.code,
          message: failure.message,
          nextAttemptAt,
          rateGateUntil: failure.rateGateUntil ?? null,
          repositoryId: failure.repositoryId ?? null,
        }),
      );
    }
    beforeOwningFailure?.();
    recordOwningFailure(
      transaction,
      connectionId,
      forgeRepositoryIds,
      failure,
      attemptedAt,
    );
    return true;
  }

  function commitSuccess(
    transaction: any,
    connectionId: string,
    prepared: {
      completedAt: number;
      expectedGeneration?: number;
      snapshots: { forgeRepositoryId: number; snapshot: unknown[] }[];
    },
    expectedGeneration?: number,
  ) {
    const generation = expectedGeneration ?? prepared.expectedGeneration;
    if (!claimForgejoPollingGeneration(transaction, connectionId, generation)) {
      return false;
    }
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = ?",
      `forgejo_poll_gate:${connectionId}`,
    );
    for (const { forgeRepositoryId, snapshot } of prepared.snapshots) {
      transaction.run(
        `INSERT INTO forgejo_repository_polls (
           connection_id, forge_repository_id, baseline_status,
           last_success_at, error_code, error_message, rate_gate_until,
           next_attempt_at, snapshot
         ) VALUES (?, ?, 'complete', ?, NULL, NULL, NULL, ?, ?)
         ON CONFLICT (connection_id, forge_repository_id) DO UPDATE SET
           baseline_status = 'complete',
           last_success_at = excluded.last_success_at,
           error_code = NULL, error_message = NULL, rate_gate_until = NULL,
           next_attempt_at = excluded.next_attempt_at,
           snapshot = excluded.snapshot`,
        connectionId,
        forgeRepositoryId,
        prepared.completedAt,
        prepared.completedAt + FORGEJO_POLL_INTERVAL_MS,
        JSON.stringify(snapshot),
      );
    }
    return true;
  }

  async function reconcile(input: {
    connection: any;
    credential: any;
    repositories: any[];
  }) {
    const prepared = await prepare(input);
    const committed = durableCore.transaction((transaction: any) =>
      commitSuccess(transaction, input.connection.id, prepared),
    );
    if (!committed) {
      throw Object.assign(
        new Error("Forgejo polling changed during reconciliation"),
        { code: "forgejo_polling_conflict" },
      );
    }
    return prepared.snapshots.map(({ forgeRepositoryId }) => forgeRepositoryId);
  }

  function recordFailure(input: {
    connectionId: string;
    error: Error & { code: string };
    forgeRepositoryId: number;
  }) {
    const failure = codedFailure(input.error);
    recordFailureState(
      input.connectionId,
      [input.forgeRepositoryId],
      failure,
      timestamp(),
      false,
    );
  }

  return {
    commitFailure,
    commitSuccess,
    prepare,
    reconcile,
    recordFailure,
  };
}
