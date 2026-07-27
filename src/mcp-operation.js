/**
 * @param {(event: {
 *   durationMs: number,
 *   errorCode?: string,
 *   operation: string,
 *   outcome: "success" | "failure",
 *   requestId: string,
 *   resourceIds: string[]
 * }) => void} record
 * @param {number} startedAt
 * @param {string | number} requestId
 * @param {string} operation
 * @param {"success" | "failure"} outcome
 * @param {string[]} resourceIds
 * @param {string} [errorCode]
 */
export function recordMcpOutcome(
  record,
  startedAt,
  requestId,
  operation,
  outcome,
  resourceIds,
  errorCode,
) {
  record({
    durationMs: Math.round(performance.now() - startedAt),
    operation,
    outcome,
    requestId: String(requestId),
    resourceIds,
    ...(errorCode ? { errorCode } : {}),
  });
}

/**
 * @param {Parameters<typeof recordMcpOutcome>[0]} record
 * @param {number} startedAt
 * @param {string | number} requestId
 * @param {string} operation
 */
export function createMcpOutcomeRecorder(
  record,
  startedAt,
  requestId,
  operation,
) {
  return (
    /** @type {"success" | "failure"} */ outcome,
    /** @type {string[]} */ resourceIds,
    /** @type {string | undefined} */ errorCode = undefined,
  ) =>
    recordMcpOutcome(
      record,
      startedAt,
      requestId,
      operation,
      outcome,
      resourceIds,
      errorCode,
    );
}
