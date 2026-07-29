import { failEvaluation } from "./evaluation-validation.js";

/** @param {unknown} error */
export function createUnavailableEvaluationService(error) {
  const failure =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? { code: error.code, message: error.message }
      : {
          code: "evaluation_capability_unavailable",
          message: "Evaluation capability is unavailable",
        };
  return {
    admitAutomatic() {
      failEvaluation(failure.code, failure.message, error);
    },
    cancel() {
      failEvaluation(failure.code, failure.message, error);
    },
    destroy() {},
    async createExplicit() {
      failEvaluation(failure.code, failure.message, error);
    },
    list() {
      failEvaluation(failure.code, failure.message, error);
    },
    read() {
      failEvaluation(failure.code, failure.message, error);
    },
    readResult() {
      failEvaluation(failure.code, failure.message, error);
    },
    readFinding() {
      failEvaluation(failure.code, failure.message, error);
    },
    readFindingById() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRun() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRunById() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRunDiagnostics() {
      failEvaluation(failure.code, failure.message, error);
    },
    submitWaiverBatch() {
      failEvaluation(failure.code, failure.message, error);
    },
  };
}
