import { failEvaluation } from "./evaluation-validation.js";
import { readReviewRunDiagnostics } from "../review/review-run-evidence.js";

/** @param {any} durableCore */
export function createEvaluationReviewRunDiagnosticsReader(durableCore) {
  return (
    /** @type {string} */ evaluationId,
    /** @type {string} */ reviewRunId,
  ) => {
    const diagnostics = readReviewRunDiagnostics(
      durableCore,
      evaluationId,
      reviewRunId,
    );
    if (diagnostics) {
      return diagnostics;
    }
    if (
      !durableCore.get("SELECT id FROM evaluations WHERE id = ?", evaluationId)
    ) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    failEvaluation("review_run_not_found", "Review Run was not found");
  };
}
