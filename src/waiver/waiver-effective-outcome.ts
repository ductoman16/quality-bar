export function effectiveEvaluationOutcome(facts: {
  activeAdjudicationCount: number;
  blockingFindingCount: number;
  currentWaiverErrorCount: number;
  resultOutcome: string;
  unwaivedAdvisoryFindingCount: number;
}) {
  if (
    !facts ||
    ![
      facts.activeAdjudicationCount,
      facts.blockingFindingCount,
      facts.currentWaiverErrorCount,
      facts.unwaivedAdvisoryFindingCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    !["pending", "clear", "advisory", "blocking", "error"].includes(
      facts.resultOutcome,
    )
  ) {
    throw new TypeError("Effective Evaluation outcome facts are invalid");
  }
  if (facts.activeAdjudicationCount > 0 || facts.resultOutcome === "pending") {
    return "pending";
  }
  if (facts.currentWaiverErrorCount > 0 || facts.resultOutcome === "error") {
    return "error";
  }
  if (facts.blockingFindingCount > 0) {
    return "blocking";
  }
  if (facts.unwaivedAdvisoryFindingCount > 0) {
    return "advisory";
  }
  return "clear";
}
