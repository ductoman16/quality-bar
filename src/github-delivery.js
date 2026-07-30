import { GitHubConnectionError } from "./github-connection-error.js";

const MAXIMUM_DELAY_MS = 60 * 60 * 1_000;
const DEFINITIVE_FAILURES = new Set([
  "github_api_request_failed",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_connection_credential_undecryptable",
  "github_connection_retired",
  "github_delivery_identity_conflict",
  "github_installation_scope_invalid",
  "github_permissions_mismatch",
  "github_principal_mismatch",
  "github_repository_api_access_failed",
]);

/**
 * @param {unknown} error
 * @param {{operation: "create" | "reconcile"}} input
 */
export function githubDeliveryFailure(error, input) {
  const codedError =
    error instanceof Error &&
    typeof (/** @type {any} */ (error).code) === "string" &&
    DEFINITIVE_FAILURES.has(/** @type {any} */ (error).code)
      ? /** @type {Error & {code: string}} */ (error)
      : null;
  if (!(error instanceof GitHubConnectionError) && !codedError) {
    throw error instanceof Error
      ? error
      : new TypeError("GitHub delivery failed with a non-Error value");
  }
  const failure = /** @type {any} */ (error);
  const definitive = DEFINITIVE_FAILURES.has(failure.code);
  const uncertain =
    !definitive &&
    input.operation === "create" &&
    (failure.code === "github_api_unavailable" ||
      failure.code === "github_api_response_invalid" ||
      (failure.code === "github_api_transient_failure" &&
        failure.responseStatus !== 429));
  const providerGate =
    failure.code === "github_api_transient_failure" &&
    (Number.isSafeInteger(failure.nextAttemptAt) ||
      [403, 429].includes(/** @type {number} */ (failure.responseStatus)));
  return {
    code: failure.code,
    detail: failure.message,
    definitive,
    ...(Array.isArray(failure.affectedRepositoryIds)
      ? { affectedRepositoryIds: failure.affectedRepositoryIds }
      : {}),
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

/**
 * @param {any} durableCore
 * @param {"commit_status" | "aggregate_feedback" | "inline_feedback"} surface
 * @param {string} sourceId
 * @param {string} target
 */
export function ensureGitHubDelivery(durableCore, surface, sourceId, target) {
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `INSERT INTO github_delivery_attempts (surface, source_id, target)
       VALUES (?, ?, ?)
       ON CONFLICT (surface, source_id) DO NOTHING`,
      surface,
      sourceId,
      target,
    );
    transaction.run(
      `UPDATE github_delivery_attempts
       SET target = ?
       WHERE surface = ? AND source_id = ?
         AND attempt_count = 0 AND connection_id IS NULL`,
      target,
      surface,
      sourceId,
    );
  });
  const [delivery] = durableCore.all(
    `SELECT * FROM github_delivery_attempts
     WHERE surface = ? AND source_id = ?`,
    surface,
    sourceId,
  );
  if (!delivery) {
    throw new TypeError("GitHub delivery source target is invalid");
  }
  return delivery;
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} attemptedAt @param {"create" | "reconcile"} operation */
export function beginGitHubDeliveryAttempt(
  durableCore,
  connectionId,
  delivery,
  attemptedAt,
  operation,
) {
  const [gate] = durableCore.all(
    `SELECT gate_until FROM github_delivery_provider_gates
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
      `DELETE FROM github_delivery_provider_gates
       WHERE connection_id = ? AND gate_until <= ?`,
      connectionId,
      attemptedAt,
    );
    const begun = transaction.run(
      `UPDATE github_delivery_attempts
       SET generation = generation + 1,
           connection_id = ?,
           authority_verified_at = (
             SELECT verified_at FROM github_connections WHERE id = ?
           ),
           attempt_count = attempt_count + 1,
           last_attempt_at = ?,
           reconciliation_required =
             CASE WHEN ? = 'create' THEN 1 ELSE reconciliation_required END,
           error_code = NULL,
           error_detail = NULL,
           response_status = NULL
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
    if (begun.changes !== 1) {
      return false;
    }
    return true;
  });
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} externalId @param {(transaction: any) => void} commitPublication */
export function succeedGitHubDelivery(
  durableCore,
  connectionId,
  delivery,
  externalId,
  commitPublication,
) {
  if (!Number.isSafeInteger(externalId) || externalId <= 0) {
    throw new TypeError("GitHub delivery external identity is invalid");
  }
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const succeeded = transaction.run(
      `UPDATE github_delivery_attempts
       SET next_attempt_at = 0,
           reconciliation_required = 0,
           external_id = ?,
           error_code = NULL,
           error_detail = NULL,
           response_status = NULL
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0
         AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM github_connections WHERE id = ?
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
export function failGitHubDelivery(
  durableCore,
  delivery,
  attemptedAt,
  failure,
  connectionId,
  commitDefinitive,
) {
  const nextAttemptAt = failure.definitive
    ? 0
    : nextGitHubDeliveryAttemptAt(
        attemptedAt,
        /** @type {number} */ (delivery.attempt_count) + 1,
        failure,
      );
  const committed = durableCore.transaction(
    (/** @type {any} */ transaction) => {
      const failed = transaction.run(
        `UPDATE github_delivery_attempts
       SET next_attempt_at = ?,
           reconciliation_required =
             CASE WHEN ? THEN 1 ELSE reconciliation_required END,
           error_code = ?,
           error_detail = ?,
           response_status = ?,
           definitive = ?
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0
         AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM github_connections WHERE id = ?
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
          `INSERT INTO github_delivery_provider_gates (
           connection_id, gate_until, error_code, error_detail
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET
           error_code = CASE
             WHEN excluded.gate_until > github_delivery_provider_gates.gate_until
               OR (
                 excluded.gate_until = github_delivery_provider_gates.gate_until
                 AND excluded.error_code || ':' || excluded.error_detail <
                     github_delivery_provider_gates.error_code || ':' ||
                     github_delivery_provider_gates.error_detail
               )
             THEN excluded.error_code ELSE error_code END,
           error_detail = CASE
             WHEN excluded.gate_until > github_delivery_provider_gates.gate_until
               OR (
                 excluded.gate_until = github_delivery_provider_gates.gate_until
                 AND excluded.error_code || ':' || excluded.error_detail <
                     github_delivery_provider_gates.error_code || ':' ||
                     github_delivery_provider_gates.error_detail
               )
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
export function proveGitHubDeliveryAbsent(
  durableCore,
  connectionId,
  delivery,
  attemptedAt,
  target,
) {
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const proven = transaction.run(
      `UPDATE github_delivery_attempts
       SET reconciliation_required = 0,
           next_attempt_at = ?,
           target = ?,
           error_code = NULL,
           error_detail = NULL,
           response_status = NULL
       WHERE surface = ? AND source_id = ?
         AND generation = ? AND definitive = 0
         AND connection_id = ?
         AND authority_verified_at = (
           SELECT verified_at FROM github_connections WHERE id = ?
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

/**
 * @param {number} attemptedAt
 * @param {number} attemptCount
 * @param {{code?: string, nextAttemptAt?: number}} failure
 */
export function nextGitHubDeliveryAttemptAt(
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
    throw new TypeError("GitHub delivery attempt facts are invalid");
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
