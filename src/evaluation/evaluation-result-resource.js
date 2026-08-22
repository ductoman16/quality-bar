import { readCompletedEvaluationResult } from "./evaluation-result-read.js";
import {
  readEvaluationCriterionResults,
  readEvaluationFindings,
} from "./evaluation-result-children.js";
import { failEvaluation } from "./evaluation-validation.js";

const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/**
 * Process and token evidence arrives after accepted, cancelled, and deadline
 * terminal authority. It remains operator diagnostics and cannot mutate their
 * canonical Review Run document. Other failures record evidence before their
 * terminal transition, so that already-immutable evidence is canonical.
 *
 * @param {Record<string, import("node:sqlite").SQLInputValue>} row
 * @param {string} executionStatus
 */
function canonicalTerminalEvidence(row, executionStatus) {
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

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 */
export function createEvaluationResultResourceReader(durableCore) {
  /** @param {string} evaluationId @param {string} reviewRunId */
  function readReviewRunRow(evaluationId, reviewRunId) {
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

  /**
   * @param {Record<string, import("node:sqlite").SQLInputValue>} row
   * @param {ReturnType<typeof readCompletedEvaluationResult>} result
   */
  function reviewRunResource(row, result) {
    const executionStatus = /** @type {string} */ (row.execution_status);
    const startedAt = /** @type {number | null} */ (row.started_at);
    const storedCompletedAt = /** @type {number | null} */ (row.completed_at);
    const completedAt =
      executionStatus === "cancelled"
        ? /** @type {number | null} */ (row.cancellation_requested_at)
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
    const runId = /** @type {string} */ (row.id);
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
      created_at: timestamp(/** @type {number} */ (row.created_at)),
      criterion_results: result
        ? result.criterion_results.filter(
            ({ review_run_id: reviewRunId }) => reviewRunId === runId,
          )
        : readEvaluationCriterionResults(
            durableCore,
            /** @type {string} */ (row.evaluation_id),
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
            /** @type {string} */ (row.evaluation_id),
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

  /** @param {string} id */
  function readResult(id) {
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
          /** @type {Record<string, import("node:sqlite").SQLInputValue>} */ (
            readReviewRunRow(id, reviewRun.id)
          ),
          result,
        );
      }),
    };
  }

  /** @param {string} evaluationId @param {string} findingId */
  function readFinding(evaluationId, findingId) {
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

  /** @param {string} evaluationId @param {string} reviewRunId */
  function readReviewRun(evaluationId, reviewRunId) {
    const row =
      /** @type {Record<string, import("node:sqlite").SQLInputValue>} */ (
        readReviewRunRow(evaluationId, reviewRunId)
      );
    const terminal = ["completed", "failed", "cancelled"].includes(
      /** @type {string} */ (row.execution_status),
    );
    const result = terminal
      ? readCompletedEvaluationResult(durableCore, evaluationId)
      : undefined;
    return reviewRunResource(row, result);
  }

  return {
    /** @param {string} findingId */
    readFindingById(findingId) {
      const row = durableCore.get(
        "SELECT evaluation_id FROM findings WHERE id = ?",
        findingId,
      );
      if (!row || typeof row.evaluation_id !== "string") {
        failEvaluation("finding_not_found", "Finding was not found");
      }
      return readFinding(row.evaluation_id, findingId);
    },
    /**
     * @param {string} evaluationId
     * @param {string} findingId
     */
    readFinding,
    readResult,
    /** @param {string} reviewRunId */
    readReviewRunById(reviewRunId) {
      const row = durableCore.get(
        "SELECT evaluation_id FROM review_runs WHERE id = ?",
        reviewRunId,
      );
      if (!row || typeof row.evaluation_id !== "string") {
        failEvaluation("review_run_not_found", "Review Run was not found");
      }
      return readReviewRun(row.evaluation_id, reviewRunId);
    },
    /**
     * @param {string} evaluationId
     * @param {string} reviewRunId
     */
    readReviewRun,
  };
}
