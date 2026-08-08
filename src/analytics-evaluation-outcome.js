import { AnalyticsError } from "./execution-analytics.js";
import { effectiveEvaluationOutcome } from "./waiver-effective-outcome.js";

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
export function evaluationOutcome(row) {
  const facts = {
    activeAdjudicationCount: row?.active_waiver_adjudication_count,
    blockingFindingCount: row?.blocking_finding_count,
    currentWaiverErrorCount: row?.current_waiver_error_count,
    unwaivedAdvisoryFindingCount: row?.unwaived_advisory_finding_count,
  };
  const storedOutcome =
    row?.effective_outcome_source ?? row?.result_outcome;
  const executionStatus = row?.execution_status;
  if (
    !Object.values(facts).every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) ||
    !["queued", "running", "completed", "failed", "cancelled"].includes(
      /** @type {string} */ (executionStatus),
    ) ||
    !(
      storedOutcome === null ||
      ["clear", "advisory", "blocking", "error"].includes(
        /** @type {string} */ (storedOutcome),
      )
    ) ||
    (storedOutcome === null && executionStatus === "completed") ||
    (storedOutcome !== null &&
      ["queued", "running"].includes(/** @type {string} */ (executionStatus)))
  ) {
    throw new AnalyticsError(
      "analytics_fact_invalid",
      "Canonical analytics fact is invalid",
    );
  }
  const resultOutcome =
    storedOutcome !== null
      ? /** @type {string} */ (storedOutcome)
      : ["failed", "cancelled"].includes(
            /** @type {string} */ (executionStatus),
          )
        ? "error"
        : "pending";
  return effectiveEvaluationOutcome({
    activeAdjudicationCount: /** @type {number} */ (
      facts.activeAdjudicationCount
    ),
    blockingFindingCount: /** @type {number} */ (facts.blockingFindingCount),
    currentWaiverErrorCount: /** @type {number} */ (
      facts.currentWaiverErrorCount
    ),
    resultOutcome,
    unwaivedAdvisoryFindingCount: /** @type {number} */ (
      facts.unwaivedAdvisoryFindingCount
    ),
  });
}
