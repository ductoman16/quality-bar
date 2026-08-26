import { readCompletedEvaluationResult } from "./evaluation-result-read.ts";
import {
  readEvaluationCriterionResults,
  readEvaluationFindings,
} from "./evaluation-result-children.ts";
import { failEvaluation } from "./evaluation-validation.ts";

const timestamp = (value: number) => new Date(value).toISOString();

/**
 * Process and token evidence arrives after accepted, cancelled, and deadline
 * terminal authority. It remains operator diagnostics and cannot mutate their
 * canonical Review Run document. Other failures record evidence before their
 * terminal transition, so that already-immutable evidence is canonical.
 */
function canonicalTerminalEvidence(
  row: Record<string, import("node:sqlite").SQLInputValue>,
  executionStatus: string,
) {
  const recordedBeforeTerminal =
    executionStatus === "failed" &&
    row.error_code !== "deadline_exceeded" &&
    row.execution_evidence_recorded === 1;
  return {
    exitCode: recordedBeforeTerminal ? row.process_exit_code : null,
    signal: recordedBeforeTerminal ? row.process_signal : null,
    tokenCounters: {
      cached_input_tokens: recordedBeforeTerminal
        ? row.cached_input_tokens
        : null,
      input_tokens: recordedBeforeTerminal ? row.input_tokens : null,
      output_tokens: recordedBeforeTerminal ? row.output_tokens : null,
    },
  };
}

export function createEvaluationResultResourceReader(durableCore: {
  all(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
  get(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
}) {
  function readReviewRunRow(evaluationId: string, reviewRunId: string) {
    const row = durableCore.get(
      `SELECT review_runs.*, evaluations.cancellation_requested_at,
              evaluations.cancellation_code,
              evaluations.cancellation_detail
       FROM review_runs
       JOIN evaluations ON evaluations.id = review_runs.evaluation_id
       WHERE review_runs.evaluation_id = ? AND review_runs.id = ?`,
      evaluationId,
      reviewRunId,
    );
    if (row) {
      return row;
    }
    if (
      !durableCore.get("SELECT id FROM evaluations WHERE id = ?", evaluationId)
    ) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    failEvaluation("review_run_not_found", "Review Run was not found");
  }

  function reviewRunResource(
    row: Record<string, import("node:sqlite").SQLInputValue>,
    result: ReturnType<typeof readCompletedEvaluationResult>,
  ) {
    const executionStatus = row.execution_status as string;
    const startedAt = row.started_at as number | null;
    const storedCompletedAt = row.completed_at as number | null;
    const completedAt =
      executionStatus === "cancelled"
        ? (row.cancellation_requested_at as number | null)
        : storedCompletedAt;
    const {
      exitCode,
      signal,
      tokenCounters: {
        cached_input_tokens: cachedInputTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    } = canonicalTerminalEvidence(row, executionStatus);
    const process =
      typeof exitCode === "number"
        ? { code: exitCode, kind: "exit" }
        : typeof signal === "string"
          ? { kind: "signal", signal }
          : { kind: "unavailable" };
    const runId = row.id as string;
    const error =
      executionStatus === "failed"
        ? {
            code: row.error_code,
            detail: row.error_detail,
          }
        : executionStatus === "cancelled"
          ? {
              code: row.cancellation_code,
              detail: row.cancellation_detail,
            }
          : undefined;
    return {
      completed_at: completedAt === null ? null : timestamp(completedAt),
      created_at: timestamp(row.created_at as number),
      criterion_results: result
        ? result.criterion_results.filter(
            ({ review_run_id: reviewRunId }) => reviewRunId === runId,
          )
        : readEvaluationCriterionResults(
            durableCore,
            row.evaluation_id as string,
            runId,
          ),
      ...(error === undefined ? {} : { error }),
      evaluation_id: row.evaluation_id,
      execution_status: executionStatus,
      findings: result
        ? result.findings.filter(
            ({ review_run_id: reviewRunId }) => reviewRunId === runId,
          )
        : readEvaluationFindings(
            durableCore,
            row.evaluation_id as string,
            runId,
          ),
      id: runId,
      measurements: {
        codex_cli_version: row.codex_cli_version,
        duration_ms:
          startedAt === null || completedAt === null
            ? null
            : completedAt - startedAt,
        process,
        token_counters: {
          cached_input_tokens: cachedInputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      },
      review_id: row.review_id,
      review_version_id: row.review_version_id,
      started_at: startedAt === null ? null : timestamp(startedAt),
    };
  }

  function readResult(id: string) {
    const result = readCompletedEvaluationResult(durableCore, id);
    if (!result) {
      if (!durableCore.get("SELECT id FROM evaluations WHERE id = ?", id)) {
        failEvaluation("evaluation_not_found", "Evaluation was not found");
      }
      failEvaluation(
        "evaluation_result_not_ready",
        "Evaluation Result is not ready",
      );
    }
    return {
      ...result,
      review_runs: result.review_runs.map((reviewRun) => {
        if (typeof reviewRun?.id !== "string") {
          throw new TypeError("Evaluation Review Run identity is invalid");
        }
        return reviewRunResource(
          readReviewRunRow(id, reviewRun.id) as Record<
            string,
            import("node:sqlite").SQLInputValue
          >,
          result,
        );
      }),
    };
  }

  function readFinding(evaluationId: string, findingId: string) {
    if (
      !durableCore.get("SELECT id FROM evaluations WHERE id = ?", evaluationId)
    ) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    const finding = readEvaluationFindings(durableCore, evaluationId).find(
      ({ id }) => id === findingId,
    );
    if (!finding) {
      failEvaluation("finding_not_found", "Finding was not found");
    }
    return finding;
  }

  function readReviewRun(evaluationId: string, reviewRunId: string) {
    const row = readReviewRunRow(evaluationId, reviewRunId) as Record<
      string,
      import("node:sqlite").SQLInputValue
    >;
    const terminal = ["completed", "failed", "cancelled"].includes(
      row.execution_status as string,
    );
    const result = terminal
      ? readCompletedEvaluationResult(durableCore, evaluationId)
      : undefined;
    return reviewRunResource(row, result);
  }

  return {
    readFindingById(findingId: string) {
      const row = durableCore.get(
        "SELECT evaluation_id FROM findings WHERE id = ?",
        findingId,
      );
      if (!row || typeof row.evaluation_id !== "string") {
        failEvaluation("finding_not_found", "Finding was not found");
      }
      return readFinding(row.evaluation_id, findingId);
    },
    readFinding,
    readResult,
    readReviewRunById(reviewRunId: string) {
      const row = durableCore.get(
        "SELECT evaluation_id FROM review_runs WHERE id = ?",
        reviewRunId,
      );
      if (!row || typeof row.evaluation_id !== "string") {
        failEvaluation("review_run_not_found", "Review Run was not found");
      }
      return readReviewRun(row.evaluation_id, reviewRunId);
    },
    readReviewRun,
  };
}
