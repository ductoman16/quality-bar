import { forgejoDefinitiveFailureScope } from "../forgejo/forgejo-failure.ts";
import { forgejoPullRequestSnapshot } from "../forgejo/forgejo-automatic-evaluation.ts";
import { pullRequestSnapshot } from "../github/github-pull-request-snapshot.ts";
import {
  optionalNextAttemptTimestamp,
  optionalTimestamp,
  readError,
} from "./system-fact-validation.ts";

export function maxMillis(left: number | null, right: number | null) {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left >= right ? left : right;
}

export function minMillis(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

export function nextAttemptState(value: number | null): {
  millis: number | null;
  afterCorrection: boolean;
} {
  if (value === null) {
    return { millis: null, afterCorrection: false };
  }
  if (value === Number.MAX_SAFE_INTEGER) {
    return { millis: null, afterCorrection: true };
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("System polling next attempt is invalid");
  }
  return { millis: value, afterCorrection: false };
}

export function nextAttemptMillis(value: number | null): number | null {
  return nextAttemptState(value).millis;
}

export function maxAttemptState(
  left: { millis: number | null; afterCorrection: boolean },
  right: { millis: number | null; afterCorrection: boolean },
) {
  const millis = maxMillis(left.millis, right.millis);
  return {
    millis,
    afterCorrection:
      millis === null && (left.afterCorrection || right.afterCorrection),
  };
}

export function readPollingSnapshot(row: any, provider: "github" | "forgejo") {
  if (row.polling_snapshot === null) {
    return null;
  }
  if (typeof row.polling_snapshot !== "string") {
    throw new TypeError(`${provider} System polling snapshot is invalid`);
  }
  try {
    const value = JSON.parse(row.polling_snapshot);
    return provider === "github"
      ? pullRequestSnapshot(value)
      : forgejoPullRequestSnapshot(value);
  } catch (cause) {
    throw new TypeError(`${provider} System polling snapshot is invalid`, {
      cause,
    });
  }
}

export function readForgejoConnectionHealthError(
  durableCore: any,
  connectionId: string,
  verifiedAt: number,
  pollingFailure: any,
) {
  const verificationError = durableCore
    .all(
      `SELECT error_code AS code, error_message AS detail
         FROM forgejo_connection_verifications
        WHERE connection_id = ? AND verified_at = ?
          AND error_code IS NOT NULL
        ORDER BY rowid DESC`,
      connectionId,
      verifiedAt,
    )
    .find(
      (row: any) =>
        forgejoDefinitiveFailureScope({ code: row.code }) === "connection",
    );
  const [deliveryError] = durableCore.all(
    `SELECT error_code AS code, error_detail AS detail
       FROM forgejo_delivery_attempts
      WHERE connection_id = ? AND last_attempt_at = ? AND definitive = 1
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
      LIMIT 1`,
    connectionId,
    verifiedAt,
  );
  const candidate =
    verificationError ??
    deliveryError ??
    (pollingFailure === null || pollingFailure.forge_repository_id !== null
      ? null
      : {
          code: pollingFailure.error.code,
          detail: pollingFailure.error.message,
        });
  if (candidate === null) {
    throw new TypeError("Forgejo System Connection health error is missing");
  }
  return readError(
    {
      health_error_code: candidate.code,
      health_error_detail: candidate.detail,
    },
    "health_error_code",
    "health_error_detail",
  );
}

export function rejectOrphanedPollingRows(
  durableCore: any,
  provider: "github" | "forgejo",
) {
  const rows = durableCore.all(`
    SELECT polls.connection_id, polls.forge_repository_id
      FROM ${provider}_repository_polls AS polls
      LEFT JOIN ${provider}_repositories AS repositories
        ON repositories.connection_id = polls.connection_id
       AND repositories.forge_repository_id = polls.forge_repository_id
     WHERE repositories.repository_id IS NULL
  `);
  if (rows.length > 0) {
    throw new TypeError(`${provider} System polling repository is orphaned`);
  }
}

export function validatePollingGateOwnership(
  durableCore: any,
  provider: "github" | "forgejo",
  connectionIds: Set<string>,
) {
  const prefix = `${provider}_poll_gate:`;
  const rows = durableCore.all(
    "SELECT key FROM quality_bar_metadata WHERE key GLOB ?",
    `${prefix}*`,
  );
  const seen = new Set();
  for (const row of rows) {
    const key = row?.key;
    const connectionId =
      typeof key === "string" && key.startsWith(prefix)
        ? key.slice(prefix.length)
        : "";
    if (
      connectionId.length === 0 ||
      seen.has(connectionId) ||
      !connectionIds.has(connectionId)
    ) {
      throw new TypeError(`${provider} System polling gate owner is invalid`);
    }
    seen.add(connectionId);
  }
}

export function pollingRepository(row: any, provider: "github" | "forgejo") {
  if (
    typeof row.repository_id !== "string" ||
    row.repository_id.length === 0 ||
    !Number.isSafeInteger(row.forge_repository_id) ||
    row.forge_repository_id <= 0 ||
    typeof row.repository_name !== "string" ||
    row.repository_name.length === 0 ||
    !["enabled", "disabled", "retired"].includes(row.repository_lifecycle) ||
    !["healthy", "error"].includes(row.repository_health) ||
    !["pending", "complete", "error"].includes(row.baseline_status) ||
    (row.last_success_at !== null &&
      (!Number.isSafeInteger(row.last_success_at) ||
        row.last_success_at < 0)) ||
    (row.next_attempt_at !== null &&
      (!Number.isSafeInteger(row.next_attempt_at) ||
        row.next_attempt_at < 0)) ||
    (row.rate_gate_until !== null &&
      (!Number.isSafeInteger(row.rate_gate_until) || row.rate_gate_until < 0))
  ) {
    throw new TypeError(`${provider} System polling repository is invalid`);
  }
  const pollingError = readError(
    row,
    "polling_error_code",
    "polling_error_detail",
  );
  const healthError = readError(
    row,
    "repository_health_error_code",
    "repository_health_error_detail",
  );
  if (
    (row.repository_health === "healthy" && healthError !== null) ||
    (row.repository_health === "error" && healthError === null)
  ) {
    throw new TypeError(
      `${provider} System polling Repository health is invalid`,
    );
  }
  const snapshot = readPollingSnapshot(row, provider);
  if (
    (row.baseline_status === "complete" && row.last_success_at === null) ||
    (row.baseline_status === "complete" && row.next_attempt_at === null) ||
    (row.baseline_status === "complete" && row.next_attempt_at === 0) ||
    (row.baseline_status === "error" && pollingError === null) ||
    (row.baseline_status === "pending" &&
      (pollingError !== null || row.next_attempt_at === null)) ||
    (provider === "github" &&
      row.baseline_status === "pending" &&
      row.last_success_at !== null) ||
    (row.baseline_status === "complete" && snapshot === null) ||
    (provider === "github" &&
      row.baseline_status === "pending" &&
      snapshot !== null) ||
    (provider === "forgejo" &&
      row.last_success_at === null &&
      snapshot !== null) ||
    (row.last_success_at !== null && snapshot === null)
  ) {
    throw new TypeError(
      `${provider} System polling repository state is invalid`,
    );
  }
  const rateGateUntil = optionalTimestamp(row.rate_gate_until);
  const rateGateUntilMillis = row.rate_gate_until;
  const nextAttemptStateValue = maxAttemptState(
    nextAttemptState(row.next_attempt_at),
    { millis: rateGateUntilMillis, afterCorrection: false },
  );
  const eligibleForAttempt =
    row.repository_lifecycle === "enabled" &&
    row.repository_health === "healthy";
  return {
    baseline_status: row.baseline_status,
    error: pollingError ?? healthError,
    health: row.repository_health,
    health_error: healthError,
    forge_repository_id: row.forge_repository_id,
    last_success_at: optionalTimestamp(row.last_success_at),
    lifecycle: row.repository_lifecycle,
    next_attempt_at: eligibleForAttempt
      ? optionalNextAttemptTimestamp(nextAttemptStateValue.millis)
      : null,
    next_attempt_after_correction: eligibleForAttempt
      ? nextAttemptStateValue.afterCorrection
      : false,
    rate_gate_until: rateGateUntil,
    repository_id: row.repository_id,
    name: row.repository_name,
    _eligible_for_attempt: eligibleForAttempt,
    _next_attempt_at_millis: eligibleForAttempt
      ? nextAttemptStateValue.millis
      : null,
    _next_attempt_after_correction: eligibleForAttempt
      ? nextAttemptStateValue.afterCorrection
      : false,
    _rate_gate_until_millis: rateGateUntilMillis,
  };
}
