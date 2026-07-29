/** @type {Map<string, Set<() => void>>} */
const reviewRunCancellationSubscribers = new Map();
export const OPERATOR_CANCELLATION = Object.freeze({
  code: "cancelled_by_operator",
  detail: "Evaluation was cancelled by the operator",
});
export const NO_REVIEW_RUN_CANCELLATION = new Promise(() => {});

/** @param {string} terminalKind */
export function closesSubmissionForCancellationOrDeadline(terminalKind) {
  return terminalKind === "cancellation" || terminalKind === "deadline";
}

/**
 * @param {string} terminalKind
 * @param {unknown} evidenceCompletionFailure
 * @param {unknown} submissionFailure
 * @param {Error[]} diagnosticFailures
 */
export function cancelledReviewRunResult(
  terminalKind,
  evidenceCompletionFailure,
  submissionFailure,
  diagnosticFailures,
) {
  if (terminalKind !== "cancellation") {
    return undefined;
  }
  if (evidenceCompletionFailure instanceof Error) {
    diagnosticFailures.push(evidenceCompletionFailure);
  }
  if (submissionFailure instanceof Error) {
    diagnosticFailures.push(submissionFailure);
  }
  return { cancelled: true, diagnosticFailures };
}

/** @param {unknown} workId */
function assertWorkId(workId) {
  if (typeof workId !== "string" || workId.length === 0) {
    throw new TypeError("Review Run cancellation subscription is invalid");
  }
}

/**
 * @param {string} workId
 * @param {() => void} signal
 */
export function subscribeReviewRunCancellation(workId, signal) {
  assertWorkId(workId);
  if (typeof signal !== "function") {
    throw new TypeError("Review Run cancellation subscription is invalid");
  }
  const subscribers = reviewRunCancellationSubscribers.get(workId) ?? new Set();
  subscribers.add(signal);
  reviewRunCancellationSubscribers.set(workId, subscribers);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    subscribers.delete(signal);
    if (subscribers.size === 0) {
      reviewRunCancellationSubscribers.delete(workId);
    }
  };
}

/** @param {string[]} workIds */
export function signalReviewRunCancellations(workIds) {
  if (
    !Array.isArray(workIds) ||
    new Set(workIds).size !== workIds.length ||
    workIds.some((workId) => typeof workId !== "string" || workId.length === 0)
  ) {
    throw new TypeError("Review Run cancellation identities are invalid");
  }
  for (const workId of workIds) {
    for (const signal of reviewRunCancellationSubscribers.get(workId) ?? []) {
      signal();
    }
  }
}

/**
 * @param {{
 *   transaction<Result>(callback: (transaction: {
 *     all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *     get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {string} evaluationId
 * @param {() => number} now
 * @param {(workIds: string[]) => void} signalCancellations
 * @param {(code: string, detail: string) => never} fail
 */
export function cancelEvaluation(
  durableCore,
  evaluationId,
  now,
  signalCancellations,
  fail,
) {
  if (typeof evaluationId !== "string" || evaluationId.length === 0) {
    throw new TypeError("Evaluation cancellation identity is invalid");
  }
  const requestedAt = now();
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
    throw new TypeError("Evaluation cancellation time is invalid");
  }
  const runningReviewRunIds = durableCore.transaction((transaction) => {
    const evaluation = transaction.get(
      "SELECT execution_status FROM evaluations WHERE id = ?",
      evaluationId,
    );
    if (!evaluation) {
      fail("evaluation_not_found", "Evaluation was not found");
    }
    if (!["queued", "running"].includes(String(evaluation.execution_status))) {
      fail(
        "evaluation_not_cancellable",
        "Evaluation is already terminal and cannot be cancelled",
      );
    }
    const unfinishedRuns = transaction.all(
      `SELECT id, execution_status FROM review_runs
       WHERE evaluation_id = ?
         AND execution_status IN ('queued', 'running')
       ORDER BY id`,
      evaluationId,
    );
    const runningIds = unfinishedRuns
      .filter((run) => run?.execution_status === "running")
      .map((run) => /** @type {string} */ (run?.id));
    const queuedIds = unfinishedRuns
      .filter((run) => run?.execution_status === "queued")
      .map((run) => /** @type {string} */ (run?.id));
    if (
      transaction.run(
        `UPDATE evaluations
         SET execution_status = 'cancelled',
             cancellation_requested_at = ?,
             cancellation_code = ?,
             cancellation_detail = ?,
             completed_at = ?
         WHERE id = ? AND execution_status IN ('queued', 'running')`,
        requestedAt,
        OPERATOR_CANCELLATION.code,
        OPERATOR_CANCELLATION.detail,
        requestedAt,
        evaluationId,
      ).changes !== 1
    ) {
      fail(
        "evaluation_not_cancellable",
        "Evaluation is already terminal and cannot be cancelled",
      );
    }
    transaction.run(
      `UPDATE review_runs
       SET execution_status = 'cancelled',
           completed_at = CASE
             WHEN started_at IS NULL THEN NULL
             ELSE ?
           END
       WHERE evaluation_id = ?
         AND execution_status IN ('queued', 'running')`,
      requestedAt,
      evaluationId,
    );
    for (const workId of queuedIds) {
      transaction.run(
        "DELETE FROM codex_execution_queue WHERE work_id = ? AND started_at IS NULL",
        workId,
      );
    }
    transaction.run(
      `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
       VALUES (?, 'error', ?)`,
      evaluationId,
      requestedAt,
    );
    return runningIds;
  });
  signalCancellations(runningReviewRunIds);
}
