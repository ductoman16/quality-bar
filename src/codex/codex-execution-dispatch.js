/**
 * @param {import("./codex-execution-claim.js").CodexExecutionClaim} claim
 * @param {{
 *   executeReviewRun: (claim: import("./codex-execution-claim.js").CodexExecutionClaim) => unknown,
 *   executeWaiverAdjudication: (claim: import("./codex-execution-claim.js").CodexExecutionClaim) => unknown
 * }} adapters
 */
export function executeClaimWithOwningAdapter(
  claim,
  { executeReviewRun, executeWaiverAdjudication },
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
