const MAXIMUM_DELAY_MS = 60 * 60 * 1_000;

const DEFINITIVE_FAILURES = new Set([
  "forgejo_connection_credential_invalid",
  "forgejo_connection_credential_undecryptable",
  "forgejo_connection_retired",
  "forgejo_publication_capability_unavailable",
  "forgejo_publication_request_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_capability_missing",
  "forgejo_repository_permission_denied",
  "forgejo_required_route_unavailable",
  "forgejo_version_unsupported",
]);

/** @param {unknown} error @param {{operation: "create" | "reconcile"}} input */
export function forgejoDeliveryFailure(error, input) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    throw error instanceof Error
      ? error
      : new TypeError("Forgejo delivery failed with a non-Error value");
  }
  const failure =
    /** @type {Error & {code: string, nextAttemptAt?: number, repositoryId?: number, responseStatus?: number}} */ (
      error
    );
  const clientFailure =
    Number.isSafeInteger(failure.responseStatus) &&
    /** @type {number} */ (failure.responseStatus) >= 400 &&
    /** @type {number} */ (failure.responseStatus) < 500 &&
    ![408, 425, 429].includes(/** @type {number} */ (failure.responseStatus));
  const definitive = DEFINITIVE_FAILURES.has(failure.code) || clientFailure;
  const rateLimited =
    failure.code === "forgejo_api_rate_limited" ||
    failure.responseStatus === 429;
  const providerGate =
    rateLimited ||
    (failure.code === "forgejo_api_transient_failure" &&
      Number.isSafeInteger(failure.nextAttemptAt));
  const uncertain =
    !definitive &&
    input.operation === "create" &&
    !rateLimited &&
    [
      "forgejo_api_request_failed",
      "forgejo_api_response_invalid",
      "forgejo_api_transient_failure",
      "forgejo_api_unavailable",
    ].includes(failure.code);
  return {
    code: failure.code,
    definitive,
    detail: failure.message,
    ...(Number.isSafeInteger(failure.nextAttemptAt)
      ? { nextAttemptAt: failure.nextAttemptAt }
      : {}),
    ...(providerGate ? { providerGate: true } : {}),
    ...(Number.isSafeInteger(failure.repositoryId)
      ? { repositoryId: failure.repositoryId }
      : {}),
    ...(Number.isSafeInteger(failure.responseStatus)
      ? { responseStatus: failure.responseStatus }
      : {}),
    uncertain,
  };
}

/** @param {number} attemptedAt @param {number} attemptCount @param {{code?: string, nextAttemptAt?: number}} failure */
export function nextForgejoDeliveryAttemptAt(
  attemptedAt,
  attemptCount,
  failure,
) {
  if (
    !Number.isSafeInteger(attemptedAt) ||
    attemptedAt < 0 ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1
  ) {
    throw new TypeError("Forgejo delivery attempt facts are invalid");
  }
  const exponentialDelay = Math.min(
    60_000 * 2 ** Math.min(attemptCount - 1, 6),
    MAXIMUM_DELAY_MS,
  );
  const providerDelay =
    Number.isSafeInteger(failure.nextAttemptAt) &&
    /** @type {number} */ (failure.nextAttemptAt) > attemptedAt
      ? /** @type {number} */ (failure.nextAttemptAt) - attemptedAt
      : 0;
  return (
    attemptedAt +
    Math.min(Math.max(exponentialDelay, providerDelay), MAXIMUM_DELAY_MS)
  );
}

/** @param {any} durableCore @param {string} surface @param {string} sourceId @param {string} target */
export function ensureForgejoDelivery(durableCore, surface, sourceId, target) {
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `INSERT INTO forgejo_delivery_attempts (surface, source_id, target)
       VALUES (?, ?, ?)
       ON CONFLICT (surface, source_id) DO NOTHING`,
      surface,
      sourceId,
      target,
    );
    transaction.run(
      `UPDATE forgejo_delivery_attempts SET target = ?
       WHERE surface = ? AND source_id = ?
         AND attempt_count = 0 AND connection_id IS NULL`,
      target,
      surface,
      sourceId,
    );
  });
  const [delivery] = durableCore.all(
    `SELECT * FROM forgejo_delivery_attempts
     WHERE surface = ? AND source_id = ?`,
    surface,
    sourceId,
  );
  if (!delivery) {
    throw new TypeError("Forgejo delivery source target is invalid");
  }
  return delivery;
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} attemptedAt @param {"create" | "reconcile"} operation */
export function beginForgejoDeliveryAttempt(
  durableCore,
  connectionId,
  delivery,
  attemptedAt,
  operation,
) {
  const [gate] = durableCore.all(
    `SELECT gate_until FROM forgejo_delivery_provider_gates
     WHERE connection_id = ? AND gate_until > ?`,
    connectionId,
    attemptedAt,
  );
  if (
    delivery.definitive === 1 ||
    delivery.next_attempt_at > attemptedAt ||
    gate
  ) {
    return false;
  }
  return durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `DELETE FROM forgejo_delivery_provider_gates
       WHERE connection_id = ? AND gate_until <= ?`,
      connectionId,
      attemptedAt,
    );
    const begun = transaction.run(
      `UPDATE forgejo_delivery_attempts
       SET generation = generation + 1, connection_id = ?,
           authority_verified_at = (
             SELECT verified_at FROM forgejo_connections WHERE id = ?
           ), attempt_count = attempt_count + 1, last_attempt_at = ?,
           reconciliation_required =
             CASE WHEN ? = 'create' THEN 1 ELSE reconciliation_required END,
           error_code = NULL, error_detail = NULL, response_status = NULL
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0`,
      connectionId,
      connectionId,
      attemptedAt,
      operation,
      delivery.surface,
      delivery.source_id,
      delivery.generation,
    );
    return begun.changes === 1;
  });
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} externalId @param {(transaction: any) => void} commitPublication */
export function succeedForgejoDelivery(
  durableCore,
  connectionId,
  delivery,
  externalId,
  commitPublication,
) {
  if (!Number.isSafeInteger(externalId) || externalId <= 0) {
    throw new TypeError("Forgejo delivery external identity is invalid");
  }
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const succeeded = transaction.run(
      `UPDATE forgejo_delivery_attempts
       SET next_attempt_at = 0, reconciliation_required = 0,
           external_id = ?, error_code = NULL, error_detail = NULL,
           response_status = NULL
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0 AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM forgejo_connections WHERE id = ?
         )`,
      externalId,
      delivery.surface,
      delivery.source_id,
      delivery.generation + 1,
      connectionId,
      connectionId,
    );
    if (succeeded.changes !== 1) {
      return false;
    }
    commitPublication(transaction);
    return true;
  });
}

/** @param {any} durableCore @param {any} delivery @param {number} attemptedAt @param {any} failure @param {string} connectionId @param {(transaction: any, failure: any) => void} commitDefinitive */
export function failForgejoDelivery(
  durableCore,
  delivery,
  attemptedAt,
  failure,
  connectionId,
  commitDefinitive,
) {
  const nextAttemptAt = failure.definitive
    ? 0
    : nextForgejoDeliveryAttemptAt(
        attemptedAt,
        delivery.attempt_count + 1,
        failure,
      );
  const committed = durableCore.transaction(
    (/** @type {any} */ transaction) => {
      const failed = transaction.run(
        `UPDATE forgejo_delivery_attempts
       SET next_attempt_at = ?,
           reconciliation_required =
             CASE WHEN ? THEN 1 ELSE reconciliation_required END,
           error_code = ?, error_detail = ?, response_status = ?, definitive = ?
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0 AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM forgejo_connections WHERE id = ?
         )`,
        nextAttemptAt,
        failure.uncertain ? 1 : 0,
        failure.code,
        failure.detail,
        failure.responseStatus ?? null,
        failure.definitive ? 1 : 0,
        delivery.surface,
        delivery.source_id,
        delivery.generation + 1,
        connectionId,
        connectionId,
      );
      if (failed.changes !== 1) {
        return false;
      }
      if (failure.providerGate) {
        transaction.run(
          `INSERT INTO forgejo_delivery_provider_gates
           (connection_id, gate_until, error_code, error_detail)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET
           error_code = CASE WHEN excluded.gate_until > gate_until
             THEN excluded.error_code ELSE error_code END,
           error_detail = CASE WHEN excluded.gate_until > gate_until
             THEN excluded.error_detail ELSE error_detail END,
           gate_until = MAX(gate_until, excluded.gate_until)`,
          connectionId,
          nextAttemptAt,
          failure.code,
          failure.detail,
        );
      }
      if (failure.definitive) {
        commitDefinitive(transaction, failure);
      }
      return true;
    },
  );
  return committed ? nextAttemptAt : null;
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} attemptedAt @param {string} target */
export function proveForgejoDeliveryAbsent(
  durableCore,
  connectionId,
  delivery,
  attemptedAt,
  target,
) {
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const proven = transaction.run(
      `UPDATE forgejo_delivery_attempts
       SET reconciliation_required = 0, next_attempt_at = ?, target = ?,
           error_code = NULL, error_detail = NULL, response_status = NULL
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0 AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM forgejo_connections WHERE id = ?
         )`,
      attemptedAt,
      target,
      delivery.surface,
      delivery.source_id,
      delivery.generation + 1,
      connectionId,
      connectionId,
    );
    return proven.changes === 1;
  });
}
