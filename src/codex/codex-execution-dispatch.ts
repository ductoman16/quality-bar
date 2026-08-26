export function executeClaimWithOwningAdapter(
  claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
  {
    executeReviewRun,
    executeWaiverAdjudication,
  }: {
    executeReviewRun: (
      claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
    ) => unknown;
    executeWaiverAdjudication: (
      claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
    ) => unknown;
  },
) {
  if (
    typeof executeReviewRun !== "function" ||
    typeof executeWaiverAdjudication !== "function"
  ) {
    throw new TypeError("Codex execution adapters are invalid");
  }
  if (claim?.workKind === "review_run") {
    return executeReviewRun(claim);
  }
  if (claim?.workKind === "waiver_adjudication") {
    return executeWaiverAdjudication(claim);
  }
  throw new TypeError("Codex execution kind is invalid");
}
