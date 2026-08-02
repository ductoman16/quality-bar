/** @param {unknown} value @param {string} name */
function jsonValue(value, name) {
  if (typeof value !== "string") {
    throw new TypeError(`Forgejo Connection ${name} is invalid`);
  }
  return JSON.parse(value);
}

/** @param {Record<string, import("node:sqlite").SQLInputValue>} row */
function verification(row) {
  if (
    typeof row.id !== "string" ||
    typeof row.trigger !== "string" ||
    !Number.isSafeInteger(row.sequence) ||
    (row.profile !== null && row.profile !== "forgejo-v16") ||
    (row.reported_version !== null &&
      typeof row.reported_version !== "string") ||
    !Number.isSafeInteger(row.verified_at) ||
    typeof row.repositories !== "string" ||
    (row.error_code === null) !== (row.error_message === null)
  ) {
    throw new TypeError("Forgejo Connection Verification row is invalid");
  }
  const error =
    row.error_code === null
      ? null
      : { code: row.error_code, message: row.error_message };
  if (
    error !== null &&
    (typeof error.code !== "string" ||
      error.code.length === 0 ||
      typeof error.message !== "string" ||
      error.message.length === 0)
  ) {
    throw new TypeError("Forgejo Connection Verification error is invalid");
  }
  const repositories = verifiedForgejoRepositoryEvidence(
    jsonValue(row.repositories, "Verification Repository checks"),
    error === null,
  );
  return {
    api_profile: row.profile,
    capabilities:
      row.capabilities === null
        ? null
        : jsonValue(row.capabilities, "Verification capabilities"),
    error,
    id: row.id,
    outcome: error === null ? "success" : "error",
    principal:
      row.principal === null
        ? null
        : jsonValue(row.principal, "Verification principal"),
    reported_version: row.reported_version,
    repositories,
    scopes:
      row.scopes === null ? null : jsonValue(row.scopes, "Verification scopes"),
    trigger: row.trigger,
    verified_at: row.verified_at,
  };
}

/**
 * @param {{
 *   all(
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[]
 * }} durableCore
 */
export function readForgejoConnection(durableCore) {
  const [row] = durableCore.all(
    `SELECT forgejo_connections.*,
       latest_delivery.error_code AS delivery_health_error_code,
       latest_delivery.error_detail AS delivery_health_error_message
     FROM forgejo_connections
     LEFT JOIN forgejo_delivery_attempts AS latest_delivery
       ON latest_delivery.rowid = (
         SELECT rowid FROM forgejo_delivery_attempts
         WHERE connection_id = forgejo_connections.id
           AND last_attempt_at = forgejo_connections.verified_at
           AND definitive = 1
           AND (
             response_status = 401
             OR error_code IN (
               'forgejo_connection_credential_invalid',
               'forgejo_connection_credential_undecryptable',
               'forgejo_publication_capability_unavailable',
               'forgejo_required_route_unavailable',
               'forgejo_version_unsupported'
             )
           )
         ORDER BY last_attempt_at DESC, rowid DESC
         LIMIT 1
       )
     LIMIT 1`,
  );
  if (!row) {
    return null;
  }
  if (
    typeof row.id !== "string" ||
    typeof row.base_url !== "string" ||
    row.api_profile !== "forgejo-v16" ||
    typeof row.reported_version !== "string" ||
    !Number.isSafeInteger(row.principal_id) ||
    typeof row.principal_login !== "string" ||
    typeof row.scopes !== "string" ||
    typeof row.capabilities !== "string" ||
    !["healthy", "error"].includes(/** @type {string} */ (row.health)) ||
    !["enabled", "retired"].includes(/** @type {string} */ (row.lifecycle)) ||
    !Number.isSafeInteger(row.verified_at)
  ) {
    throw new TypeError("Forgejo Connection row is invalid");
  }
  const pollingGate = readForgejoPollingGate(durableCore, row.id);
  const connectionVerificationError =
    row.health === "error"
      ? (durableCore
          .all(
            `SELECT error_code AS code, error_message AS message
             FROM forgejo_connection_verifications
             WHERE connection_id = ? AND verified_at = ?
               AND error_code IS NOT NULL
             ORDER BY rowid DESC`,
            row.id,
            row.verified_at,
          )
          .find(
            (failure) =>
              failure !== undefined &&
              forgejoDefinitiveFailureScope(failure) === "connection",
          ) ?? null)
      : null;
  const deliveryHealthError =
    typeof row.delivery_health_error_code === "string" &&
    typeof row.delivery_health_error_message === "string"
      ? {
          code: row.delivery_health_error_code,
          message: row.delivery_health_error_message,
        }
      : null;
  const healthError =
    row.health === "error"
      ? (connectionVerificationError ??
        deliveryHealthError ??
        pollingGate?.error)
      : null;
  if (
    (row.health === "healthy" &&
      (connectionVerificationError !== null || deliveryHealthError !== null)) ||
    (row.health === "error" &&
      (typeof healthError?.code !== "string" ||
        healthError.code.length === 0 ||
        typeof healthError.message !== "string" ||
        healthError.message.length === 0))
  ) {
    throw new TypeError("Forgejo Connection health error is invalid");
  }
  const history = durableCore
    .all(
      `SELECT rowid AS sequence, id, trigger, profile, reported_version,
         principal, scopes, capabilities, repositories, error_code,
         error_message, verified_at
       FROM forgejo_connection_verifications
       WHERE connection_id = ?
       ORDER BY sequence`,
      row.id,
    )
    .map((candidate) => {
      if (!candidate) {
        throw new TypeError("Forgejo Connection Verification row is invalid");
      }
      return verification(candidate);
    });
  if (history.length === 0) {
    throw new TypeError("Forgejo Connection verification history is invalid");
  }
  return {
    api_profile: row.api_profile,
    base_url: row.base_url,
    capabilities: jsonValue(row.capabilities, "capabilities"),
    health: row.health,
    health_error: healthError,
    id: row.id,
    lifecycle: row.lifecycle,
    polling: readForgejoPollingStates(durableCore, row.id),
    polling_failure: readForgejoPollingFailure(durableCore, row.id),
    principal: { id: row.principal_id, login: row.principal_login },
    reported_version: row.reported_version,
    scopes: jsonValue(row.scopes, "scopes"),
    verification_history: history,
    verified_at: row.verified_at,
  };
}
import { verifiedForgejoRepositoryEvidence } from "./forgejo-repository-check.js";
import {
  readForgejoPollingFailure,
  readForgejoPollingGate,
  readForgejoPollingStates,
} from "./forgejo-polling-read.js";
import { forgejoDefinitiveFailureScope } from "./forgejo-failure.js";
