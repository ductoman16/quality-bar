import { AnalyticsError } from "../execution-analytics.ts";
import { effectiveEvaluationOutcome } from "../waiver/waiver-effective-outcome.ts";

export function evaluationOutcome(
  row: Record<string, import("node:sqlite").SQLInputValue> | undefined,
) {
  const facts = {
    activeAdjudicationCount: row?.active_waiver_adjudication_count,
    blockingFindingCount: row?.blocking_finding_count,
    currentWaiverErrorCount: row?.current_waiver_error_count,
    unwaivedAdvisoryFindingCount: row?.unwaived_advisory_finding_count,
  };
  const storedOutcome = row?.effective_outcome_source ?? row?.result_outcome;
  const executionStatus = row?.execution_status;
  if (
    !Object.values(facts).every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) ||
    !["queued", "running", "completed", "failed", "cancelled"].includes(
      executionStatus as string,
    ) ||
    !(
      storedOutcome === null ||
      ["clear", "advisory", "blocking", "error"].includes(
        storedOutcome as string,
      )
    ) ||
    (storedOutcome === null && executionStatus === "completed") ||
    (storedOutcome !== null &&
      ["queued", "running"].includes(executionStatus as string))
  ) {
    throw new AnalyticsError(
      "analytics_fact_invalid",
      "Canonical analytics fact is invalid",
    );
  }
  const resultOutcome =
    storedOutcome !== null
      ? (storedOutcome as string)
      : ["failed", "cancelled"].includes(executionStatus as string)
        ? "error"
        : "pending";
  return effectiveEvaluationOutcome({
    activeAdjudicationCount: facts.activeAdjudicationCount as number,
    blockingFindingCount: facts.blockingFindingCount as number,
    currentWaiverErrorCount: facts.currentWaiverErrorCount as number,
    resultOutcome,
    unwaivedAdvisoryFindingCount: facts.unwaivedAdvisoryFindingCount as number,
  });
}
