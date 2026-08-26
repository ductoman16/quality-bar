export function waiverRequestNextAction(facts: {
  acceptedRequestCount: number;
  latestDecision: "accepted" | "denied" | "error" | null;
  requestCount: number;
}) {
  if (
    !facts ||
    !Number.isSafeInteger(facts.acceptedRequestCount) ||
    !Number.isSafeInteger(facts.requestCount) ||
    facts.acceptedRequestCount < 0 ||
    facts.acceptedRequestCount > facts.requestCount ||
    facts.requestCount < 0 ||
    facts.requestCount > 3 ||
    ![null, "accepted", "denied", "error"].includes(facts.latestDecision) ||
    (facts.requestCount === 0 && facts.latestDecision !== null)
  ) {
    throw new TypeError("Waiver Request lifecycle facts are invalid");
  }
  if (facts.acceptedRequestCount > 0) {
    return "accepted";
  }
  if (facts.requestCount === 0) {
    return "new_request";
  }
  if (facts.latestDecision === "accepted") {
    return "accepted";
  }
  if (facts.latestDecision === "error") {
    return "retry_error";
  }
  if (facts.requestCount === 3) {
    return "limit_reached";
  }
  if (facts.latestDecision === null) {
    return "decision_required";
  }
  return "new_request";
}
