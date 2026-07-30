import { GitHubConnectionError } from "./github-connection-error.js";

const MAXIMUM_DELAY_MS = 60 * 60 * 1_000;
const DEFINITIVE_FAILURES = new Set([
  "github_api_request_failed",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_connection_credential_undecryptable",
  "github_connection_retired",
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
  if (!(error instanceof GitHubConnectionError)) {
    throw error instanceof Error
      ? error
      : new TypeError("GitHub delivery failed with a non-Error value");
  }
  const definitive = DEFINITIVE_FAILURES.has(error.code);
  const uncertain =
    !definitive &&
    input.operation === "create" &&
    (error.code === "github_api_unavailable" ||
      error.code === "github_api_response_invalid" ||
      (error.code === "github_api_transient_failure" &&
        error.responseStatus !== 429));
  return {
    code: error.code,
    detail: error.message,
    definitive,
    ...(Number.isSafeInteger(error.nextAttemptAt)
      ? { nextAttemptAt: error.nextAttemptAt }
      : {}),
    ...(error.code === "github_api_transient_failure" &&
    Number.isSafeInteger(error.nextAttemptAt) &&
    Number.isSafeInteger(error.responseStatus) &&
    [403, 429].includes(/** @type {number} */ (error.responseStatus))
      ? { providerGate: true }
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
  durableCore.transaction((/** @type {any} */ transaction) =>
    transaction.run(
      `INSERT INTO github_delivery_attempts (surface, source_id, target)
       VALUES (?, ?, ?)
       ON CONFLICT (surface, source_id) DO NOTHING`,
      surface,
      sourceId,
      target,
    ),
  );
  const [delivery] = durableCore.all(
    `SELECT * FROM github_delivery_attempts
     WHERE surface = ? AND source_id = ?`,
    surface,
    sourceId,
  );
  if (!delivery || delivery.target !== target) {
    throw new TypeError("GitHub delivery source target is invalid");
  }
  return delivery;
}

/** @param {any} durableCore @param {string} connectionId @param {any} delivery @param {number} attemptedAt */
export function beginGitHubDeliveryAttempt(
  durableCore,
  connectionId,
  delivery,
  attemptedAt,
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
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `DELETE FROM github_delivery_provider_gates
       WHERE connection_id = ? AND gate_until <= ?`,
      connectionId,
      attemptedAt,
    );
    transaction.run(
      `UPDATE github_delivery_attempts
       SET attempt_count = attempt_count + 1,
           last_attempt_at = ?,
           error_code = NULL,
           error_detail = NULL
       WHERE surface = ? AND source_id = ? AND definitive = 0`,
      attemptedAt,
      delivery.surface,
      delivery.source_id,
    );
  });
  return true;
}

/** @param {any} durableCore @param {any} delivery @param {number} externalId */
export function succeedGitHubDelivery(durableCore, delivery, externalId) {
  if (!Number.isSafeInteger(externalId) || externalId <= 0) {
    throw new TypeError("GitHub delivery external identity is invalid");
  }
  durableCore.transaction((/** @type {any} */ transaction) =>
    transaction.run(
      `UPDATE github_delivery_attempts
       SET next_attempt_at = 0,
           reconciliation_required = 0,
           external_id = ?,
           error_code = NULL,
           error_detail = NULL
       WHERE surface = ? AND source_id = ?`,
      externalId,
      delivery.surface,
      delivery.source_id,
    ),
  );
}

/** @param {any} durableCore @param {any} delivery @param {number} attemptedAt @param {any} failure @param {string} connectionId */
export function failGitHubDelivery(
  durableCore,
  delivery,
  attemptedAt,
  failure,
  connectionId,
) {
  const nextAttemptAt = failure.definitive
    ? 0
    : nextGitHubDeliveryAttemptAt(
        attemptedAt,
        /** @type {number} */ (delivery.attempt_count) + 1,
        failure,
      );
  durableCore.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `UPDATE github_delivery_attempts
       SET next_attempt_at = ?,
           reconciliation_required =
             CASE WHEN ? THEN 1 ELSE reconciliation_required END,
           error_code = ?,
           error_detail = ?,
           definitive = ?
       WHERE surface = ? AND source_id = ?`,
      nextAttemptAt,
      failure.uncertain ? 1 : 0,
      failure.code,
      failure.detail,
      failure.definitive ? 1 : 0,
      delivery.surface,
      delivery.source_id,
    );
    if (failure.providerGate) {
      transaction.run(
        `INSERT INTO github_delivery_provider_gates (
           connection_id, gate_until, error_code, error_detail
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (connection_id) DO UPDATE SET
           gate_until = MAX(gate_until, excluded.gate_until),
           error_code = excluded.error_code,
           error_detail = excluded.error_detail`,
        connectionId,
        nextAttemptAt,
        failure.code,
        failure.detail,
      );
    }
  });
  return nextAttemptAt;
}

/** @param {any} durableCore @param {any} delivery @param {number} attemptedAt */
export function proveGitHubDeliveryAbsent(durableCore, delivery, attemptedAt) {
  durableCore.transaction((/** @type {any} */ transaction) =>
    transaction.run(
      `UPDATE github_delivery_attempts
       SET reconciliation_required = 0,
           next_attempt_at = ?,
           error_code = NULL,
           error_detail = NULL
       WHERE surface = ? AND source_id = ?`,
      attemptedAt,
      delivery.surface,
      delivery.source_id,
    ),
  );
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
