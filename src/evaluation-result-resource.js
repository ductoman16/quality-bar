import { readCompletedEvaluationResult } from "./evaluation-result-read.js";
import { failEvaluation } from "./evaluation-validation.js";

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 */
export function createEvaluationResultResourceReader(durableCore) {
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
    return result;
  }

  return {
    /**
     * @param {string} evaluationId
     * @param {string} findingId
     */
    readFinding(evaluationId, findingId) {
      const finding = readResult(evaluationId).findings.find(
        ({ id }) => id === findingId,
      );
      if (!finding) {
        failEvaluation("finding_not_found", "Finding was not found");
      }
      return finding;
    },
    readResult,
    /**
     * @param {string} evaluationId
     * @param {string} reviewRunId
     */
    readReviewRun(evaluationId, reviewRunId) {
      const reviewRun = readResult(evaluationId).review_runs.find(
        ({ id }) => id === reviewRunId,
      );
      if (!reviewRun) {
        failEvaluation("review_run_not_found", "Review Run was not found");
      }
      return reviewRun;
    },
  };
}
