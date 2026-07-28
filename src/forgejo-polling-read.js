/** @param {{all: Function}} durableCore @param {string} connectionId */
export function readForgejoPollingStates(durableCore, connectionId) {
  return durableCore
    .all(
      `SELECT forge_repository_id, baseline_status, last_success_at,
              error_code, error_message, rate_gate_until, next_attempt_at
         FROM forgejo_repository_polls
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
        throw new TypeError("Forgejo polling state is invalid");
      }
      if (
        row.baseline_status === "complete" &&
        !Number.isSafeInteger(row.last_success_at)
      ) {
        throw new TypeError("Forgejo polling success state is invalid");
      }
      if (
        row.baseline_status === "pending" &&
        (row.error_code !== null || !Number.isSafeInteger(row.next_attempt_at))
      ) {
        throw new TypeError("Forgejo polling pending state is invalid");
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
export function readForgejoPollingGate(durableCore, connectionId) {
  const [row] = durableCore.all(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    `forgejo_poll_gate:${connectionId}`,
  );
  if (!row) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(row.value);
  } catch (cause) {
    throw new TypeError("Forgejo polling failure is invalid", { cause });
  }
  if (
    !value ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    (value.nextAttemptAt !== null &&
      !Number.isSafeInteger(value.nextAttemptAt)) ||
    (value.repositoryId !== null && !Number.isSafeInteger(value.repositoryId))
  ) {
    throw new TypeError("Forgejo polling failure is invalid");
  }
  return {
    error: { code: value.code, message: value.message },
    forge_repository_id: value.repositoryId,
    next_attempt_at: value.nextAttemptAt,
    rate_gate_until: value.nextAttemptAt,
  };
}

/** @param {{all: Function}} durableCore @param {string} connectionId */
export function readForgejoPollingFailure(durableCore, connectionId) {
  const failure = readForgejoPollingGate(durableCore, connectionId);
  if (
    failure !== null &&
    failure.forge_repository_id !== null &&
    durableCore.all(
      `SELECT 1 FROM forgejo_repository_polls
        WHERE connection_id = ? AND forge_repository_id = ? LIMIT 1`,
      connectionId,
      failure.forge_repository_id,
    ).length > 0
  ) {
    return null;
  }
  return failure;
}
