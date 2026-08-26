import {
  EVALUATION_CANCELLATION_CODES,
  OPERATOR_CANCELLATION,
} from "./evaluation-cancellation-reason.ts";

export {
  OPERATOR_CANCELLATION,
  SUPERSESSION_CANCELLATION,
} from "./evaluation-cancellation-reason.ts";

const reviewRunCancellationSubscribers: Map<
  string,
  Set<() => void>
> = new Map();
export const NO_REVIEW_RUN_CANCELLATION = new Promise<void>(() => {});
const CANCELLATION_CODES: Set<string> = new Set(EVALUATION_CANCELLATION_CODES);

export function closesSubmissionForCancellationOrDeadline(
  terminalKind: string,
) {
  return terminalKind === "cancellation" || terminalKind === "deadline";
}

export function cancelledReviewRunResult(
  terminalKind: string,
  evidenceCompletionFailure: unknown,
  submissionFailure: unknown,
  diagnosticFailures: Error[],
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

function assertWorkId(workId: unknown) {
  if (typeof workId !== "string" || workId.length === 0) {
    throw new TypeError("Review Run cancellation subscription is invalid");
  }
}

export function subscribeReviewRunCancellation(
  workId: string,
  signal: () => void,
) {
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

export function signalReviewRunCancellations(workIds: string[]) {
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

export function cancelEvaluationInTransaction(
  transaction: {
    all(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
    run(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): import("node:sqlite").StatementResultingChanges;
  },
  evaluationId: string,
  requestedAt: number,
  cancellation: { code: string; detail: string },
  fail: (code: string, detail: string) => never,
) {
  if (
    typeof transaction?.all !== "function" ||
    typeof transaction.get !== "function" ||
    typeof transaction.run !== "function" ||
    typeof evaluationId !== "string" ||
    evaluationId.length === 0 ||
    !Number.isSafeInteger(requestedAt) ||
    requestedAt < 0 ||
    !CANCELLATION_CODES.has(cancellation?.code) ||
    typeof cancellation?.detail !== "string" ||
    cancellation.detail.length === 0 ||
    typeof fail !== "function"
  ) {
    throw new TypeError("Evaluation cancellation transaction is invalid");
  }
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
    .map((run) => run?.id as string);
  const queuedIds = unfinishedRuns
    .filter((run) => run?.execution_status === "queued")
    .map((run) => run?.id as string);
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
      cancellation.code,
      cancellation.detail,
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
}

export function cancelEvaluation(
  durableCore: {
    transaction<Result>(
      callback: (transaction: {
        all(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
        get(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
        run(
          sql: string,
          ...parameters: import("node:sqlite").SQLInputValue[]
        ): import("node:sqlite").StatementResultingChanges;
      }) => Result,
    ): Result;
  },
  evaluationId: string,
  now: () => number,
  signalCancellations: (workIds: string[]) => void,
  fail: (code: string, detail: string) => never,
) {
  if (typeof evaluationId !== "string" || evaluationId.length === 0) {
    throw new TypeError("Evaluation cancellation identity is invalid");
  }
  const requestedAt = now();
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
    throw new TypeError("Evaluation cancellation time is invalid");
  }
  const runningReviewRunIds = durableCore.transaction((transaction) =>
    cancelEvaluationInTransaction(
      transaction,
      evaluationId,
      requestedAt,
      OPERATOR_CANCELLATION,
      fail,
    ),
  );
  signalCancellations(runningReviewRunIds);
}
