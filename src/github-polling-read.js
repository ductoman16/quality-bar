/** @param {{all: Function}} durableCore @param {string} connectionId */
export function readGitHubPollingStates(durableCore, connectionId) {
  return durableCore
    .all(
      `SELECT forge_repository_id, baseline_status, last_success_at,
              error_code, error_message, rate_gate_until, next_attempt_at
         FROM github_repository_polls
        WHERE connection_id = ?
        ORDER BY forge_repository_id`,
      connectionId,
    )
    .map((/** @type {any} */ row) => {
      if (
        !row ||
        !Number.isSafeInteger(row.forge_repository_id) ||
        !["pending", "complete", "error"].includes(row.baseline_status) ||
        (row.last_success_at !== null &&
          !Number.isSafeInteger(row.last_success_at)) ||
        (row.next_attempt_at !== null &&
          !Number.isSafeInteger(row.next_attempt_at)) ||
        (row.rate_gate_until !== null &&
          !Number.isSafeInteger(row.rate_gate_until)) ||
        (row.error_code === null) !== (row.error_message === null)
      ) {
        throw new TypeError("GitHub polling state is invalid");
      }
      if (
        row.baseline_status === "complete" &&
        !Number.isSafeInteger(row.last_success_at)
      ) {
        throw new TypeError("GitHub polling success state is invalid");
      }
      if (
        row.baseline_status === "pending" &&
        (row.last_success_at !== null ||
          row.error_code !== null ||
          !Number.isSafeInteger(row.next_attempt_at))
      ) {
        throw new TypeError("GitHub polling pending state is invalid");
      }
      return {
        baseline_status: row.baseline_status,
        error:
          row.error_code === null
            ? null
            : { code: row.error_code, message: row.error_message },
        forge_repository_id: row.forge_repository_id,
        last_success_at: row.last_success_at,
        next_attempt_at: row.next_attempt_at,
        rate_gate_until: row.rate_gate_until,
      };
    });
}

/** @param {{all: Function}} durableCore @param {string} connectionId */
export function readGitHubPollingFailure(durableCore, connectionId) {
  const [row] = durableCore.all(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    `github_poll_gate:${connectionId}`,
  );
  if (!row) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(row.value);
  } catch (cause) {
    throw new TypeError("GitHub polling failure is invalid", { cause });
  }
  if (
    !value ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    (value.nextAttemptAt !== null &&
      !Number.isSafeInteger(value.nextAttemptAt)) ||
    typeof value.hasUnrepresentedFailureOwner !== "boolean" ||
    (value.rateGateUntil !== null &&
      !Number.isSafeInteger(value.rateGateUntil)) ||
    (value.forgeRepositoryId !== null &&
      !Number.isSafeInteger(value.forgeRepositoryId))
  ) {
    throw new TypeError("GitHub polling failure is invalid");
  }
  if (
    !value.hasUnrepresentedFailureOwner &&
    durableCore.all(
      `SELECT 1 FROM github_repository_polls
        WHERE connection_id = ?
          AND (? IS NULL OR forge_repository_id = ?)
        LIMIT 1`,
      connectionId,
      value.forgeRepositoryId,
      value.forgeRepositoryId,
    ).length > 0
  ) {
    return null;
  }
  return {
    error: { code: value.code, message: value.message },
    forge_repository_id: value.forgeRepositoryId,
    next_attempt_at: value.nextAttemptAt,
    rate_gate_until: value.rateGateUntil,
  };
}
