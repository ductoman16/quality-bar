export const FORGEJO_POLL_INTERVAL_MS = 60_000;

const DEFINITIVE_FAILURES = new Set([
  "forgejo_connection_credential_invalid",
  "forgejo_connection_credential_undecryptable",
  "forgejo_credential_undecryptable",
  "forgejo_poll_response_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_permission_denied",
  "forgejo_version_unsupported",
]);

/** @param {{code?: string}} failure */
export function isDefinitiveForgejoPollingFailure(failure) {
  return (
    typeof failure.code === "string" && DEFINITIVE_FAILURES.has(failure.code)
  );
}

/** @param {number} attemptedAt @param {{code?: string, nextAttemptAt?: number}} failure */
export function nextForgejoAttemptAt(attemptedAt, failure) {
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
    throw new TypeError("Forgejo polling attempt time is invalid");
  }
  if (isDefinitiveForgejoPollingFailure(failure)) {
    return null;
  }
  const providerAttemptAt = failure.nextAttemptAt;
  return Number.isSafeInteger(providerAttemptAt) &&
    Number(providerAttemptAt) >= attemptedAt
    ? Number(providerAttemptAt)
    : attemptedAt + FORGEJO_POLL_INTERVAL_MS;
}

/** @param {unknown} error */
function codedFailure(error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return /** @type {Error & {code: string, nextAttemptAt?: number, rateGateUntil?: number, repositoryId?: number}} */ (
      error
    );
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new TypeError("Forgejo polling failed with a non-Error value");
}

/** @param {any} transaction @param {string} connectionId */
function pollingGeneration(transaction, connectionId) {
  const row = transaction.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    `forgejo_poll_generation:${connectionId}`,
  );
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

/**
 * @param {any} transaction
 * @param {string} connectionId
 * @param {number | undefined} expectedGeneration
 */
function claimPollingGeneration(transaction, connectionId, expectedGeneration) {
  const current = pollingGeneration(transaction, connectionId);
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

/**
 * @param {{all: Function, transaction: Function}} durableCore
 * @param {{fetchPullRequests: (input: {connection: any, credential: any, repository: any}) => Promise<unknown[]>, now?: () => number, recordOwningFailure: (transaction: any, connectionId: string, forgeRepositoryIds: number[], failure: Error & {code: string, repositoryId?: number}, attemptedAt: number) => void}} options
 */
export function createForgejoPollingService(
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

  /** @param {string} connectionId @param {number} attemptedAt */
  function requirePermittedAttempt(connectionId, attemptedAt) {
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

  /**
   * @param {{connection: any, credential: any, repositories: any[]}} input
   * @param {{baseline?: boolean, ignoreGate?: boolean, recordFailure?: boolean}} [options]
   */
  async function prepare(
    input,
    { baseline = false, ignoreGate = false, recordFailure = true } = {},
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
        recordFailureState(
          input.connection.id,
          input.repositories.map(({ id }) => id),
          failure,
          attemptedAt,
          baseline,
        );
      }
      throw failure;
    }
    return { completedAt: timestamp(), snapshots };
  }

  /**
   * @param {string} connectionId
   * @param {number[]} forgeRepositoryIds
   * @param {Error & {code: string, nextAttemptAt?: number, rateGateUntil?: number, repositoryId?: number}} failure
   * @param {number} attemptedAt
   * @param {boolean} baseline
   */
  function recordFailureState(
    connectionId,
    forgeRepositoryIds,
    failure,
    attemptedAt,
    baseline,
  ) {
    durableCore.transaction((/** @type {any} */ transaction) => {
      commitFailure(
        transaction,
        connectionId,
        forgeRepositoryIds,
        failure,
        attemptedAt,
        baseline,
      );
    });
  }

  /**
   * @param {any} transaction
   * @param {string} connectionId
   * @param {number[]} forgeRepositoryIds
   * @param {Error & {code: string, nextAttemptAt?: number, rateGateUntil?: number, repositoryId?: number}} failure
   * @param {number} attemptedAt
   * @param {boolean} baseline
   * @param {number} [expectedGeneration]
   */
  function commitFailure(
    transaction,
    connectionId,
    forgeRepositoryIds,
    failure,
    attemptedAt,
    baseline,
    expectedGeneration,
  ) {
    if (
      !claimPollingGeneration(transaction, connectionId, expectedGeneration)
    ) {
      return false;
    }
    const nextAttemptAt = nextForgejoAttemptAt(attemptedAt, failure);
    for (const forgeRepositoryId of forgeRepositoryIds) {
      if (
        failure.repositoryId !== undefined &&
        failure.repositoryId !== forgeRepositoryId
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
    recordOwningFailure(
      transaction,
      connectionId,
      forgeRepositoryIds,
      failure,
      attemptedAt,
    );
    return true;
  }

  /**
   * @param {any} transaction
   * @param {string} connectionId
   * @param {{completedAt: number, snapshots: {forgeRepositoryId: number, snapshot: unknown[]}[]}} prepared
   * @param {number} [expectedGeneration]
   */
  function commitSuccess(
    transaction,
    connectionId,
    prepared,
    expectedGeneration,
  ) {
    if (
      !claimPollingGeneration(transaction, connectionId, expectedGeneration)
    ) {
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

  /** @param {{connection: any, credential: any, repositories: any[]}} input */
  async function reconcile(input) {
    const prepared = await prepare(input);
    durableCore.transaction((/** @type {any} */ transaction) => {
      commitSuccess(transaction, input.connection.id, prepared);
    });
    return prepared.snapshots.map(({ forgeRepositoryId }) => forgeRepositoryId);
  }

  /** @param {{connectionId: string, error: Error & {code: string}, forgeRepositoryId: number}} input */
  function recordFailure(input) {
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
