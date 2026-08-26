const nonblank = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0;

function requireIdentity(identity: any) {
  if (
    !identity ||
    ![
      identity.adjudication_id,
      identity.base_commit,
      identity.details_url,
      identity.evaluation_id,
      identity.head_commit,
      identity.outcome,
    ].every(nonblank)
  ) {
    throw new TypeError("Waiver follow-up identity is invalid");
  }
}

function decisionDetail(decision: any) {
  if (
    !decision ||
    !nonblank(decision.finding_id) ||
    !nonblank(decision.request_id) ||
    !["accepted", "denied", "error"].includes(decision.outcome)
  ) {
    throw new TypeError("Waiver Decision follow-up is invalid");
  }
  if (decision.outcome === "error") {
    if (!nonblank(decision.error_code) || !nonblank(decision.error_detail)) {
      throw new TypeError("Waiver Decision follow-up is invalid");
    }
    return `Error: ${decision.error_code}: ${decision.error_detail}`;
  }
  if (!nonblank(decision.explanation)) {
    throw new TypeError("Waiver Decision follow-up is invalid");
  }
  return `Explanation: ${decision.explanation}`;
}

export function formatWaiverAdjudicationFollowup(
  identity: any,
  decisions: any[],
) {
  requireIdentity(identity);
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new TypeError("Completed Waiver Decisions are required");
  }
  const sections = decisions.map(
    (decision) => `### Waiver Request \`${decision.request_id}\`
Finding: \`${decision.finding_id}\`
Decision: ${decision.outcome}
${decisionDetail(decision)}`,
  );
  return `## Quality Bar Waiver Adjudication

Recomputed outcome: ${identity.outcome}
Adjudication: \`${identity.adjudication_id}\`
Evaluation: \`${identity.evaluation_id}\`
Frozen base: \`${identity.base_commit}\`
Frozen head: \`${identity.head_commit}\`
Internal details: ${identity.details_url}

${sections.join("\n\n")}`;
}

export function formatWaiverDecisionFollowup(identity: any, decision: any) {
  requireIdentity(identity);
  if (decision?.outcome !== "accepted") {
    throw new TypeError("Accepted Waiver Decision is required");
  }
  decisionDetail(decision);
  return `**Quality Bar — waiver accepted**

${decision.explanation}

Finding: \`${decision.finding_id}\`
Waiver Request: \`${decision.request_id}\`
Evaluation: \`${identity.evaluation_id}\`
Adjudication: \`${identity.adjudication_id}\`
Frozen base: \`${identity.base_commit}\`
Frozen head: \`${identity.head_commit}\`
[Internal details](${identity.details_url})`;
}
