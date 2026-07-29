/** @param {any} location */
function formatLocation(location) {
  if (location.kind === "changeset") {
    return "Changeset";
  }
  const side = location.side;
  const path = `\`${location.path}\``;
  if (location.kind === "whole_side") {
    return `${side} ${path} whole side`;
  }
  const lines =
    location.start_line === location.end_line
      ? `line ${location.start_line}`
      : `lines ${location.start_line}-${location.end_line}`;
  return `${side} ${path} ${lines}`;
}

/**
 * @param {{base_commit: string, details_url: string, evaluation_id: string, head_commit: string, outcome: string}} identity
 * @param {{evidence: string, id: string, impact: string, location: any, remediation: string}[]} findings
 */
export function formatGitHubAggregateFeedback(identity, findings) {
  const sections = findings.map(
    (finding) => `### Finding \`${finding.id}\`
Impact: ${finding.impact}
Location: ${formatLocation(finding.location)}
Evidence: ${finding.evidence}
Remediation: ${finding.remediation}`,
  );
  return `## Quality Bar Evaluation

Outcome: ${identity.outcome}
Evaluation: \`${identity.evaluation_id}\`
Frozen base: \`${identity.base_commit}\`
Frozen head: \`${identity.head_commit}\`
Internal details: ${identity.details_url}${sections.length ? `\n\n${sections.join("\n\n")}` : ""}`;
}

/**
 * @param {{base_commit: string, details_url: string, evaluation_id: string, head_commit: string}} identity
 * @param {{evidence: string, id: string, impact: string, remediation: string}} finding
 */
export function formatGitHubInlineFeedback(identity, finding) {
  return `**Quality Bar — ${finding.impact}**

${finding.evidence}

Remediation: ${finding.remediation}

Finding: \`${finding.id}\`
Evaluation: \`${identity.evaluation_id}\`
Frozen base: \`${identity.base_commit}\`
Frozen head: \`${identity.head_commit}\`
[Internal details](${identity.details_url})`;
}

/** @param {string} patch */
function frozenDiffLines(patch) {
  const sides = { base: new Set(), head: new Set() };
  let baseLine = 0;
  let headLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = /^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/.exec(
      line,
    );
    if (header) {
      baseLine = Number(header[1]);
      headLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("diff --git ") || line.startsWith("@@")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("-")) {
      sides.base.add(baseLine++);
      continue;
    }
    if (line.startsWith("+")) {
      sides.head.add(headLine++);
      continue;
    }
    if (line.startsWith(" ")) {
      sides.base.add(baseLine++);
      sides.head.add(headLine++);
      continue;
    }
    inHunk = false;
  }
  return sides;
}

/**
 * @param {any} location
 * @param {{after_path: string | null, before_path: string | null, patch: string}} fileChange
 */
export function projectFrozenDiffLineRange(location, fileChange) {
  if (
    location?.kind !== "line_range" ||
    !["base", "head"].includes(location.side) ||
    !Number.isSafeInteger(location.start_line) ||
    !Number.isSafeInteger(location.end_line) ||
    location.start_line < 1 ||
    location.end_line < location.start_line ||
    typeof fileChange?.patch !== "string"
  ) {
    return null;
  }
  const path = fileChange.after_path ?? fileChange.before_path;
  if (typeof path !== "string") {
    return null;
  }
  const locationSide = /** @type {"base" | "head"} */ (location.side);
  const lines = frozenDiffLines(fileChange.patch)[locationSide];
  for (let line = location.start_line; line <= location.end_line; line += 1) {
    if (!lines.has(line)) {
      return null;
    }
  }
  const side = location.side === "base" ? "LEFT" : "RIGHT";
  return {
    line: location.end_line,
    path,
    side,
    ...(location.start_line === location.end_line
      ? {}
      : { start_line: location.start_line, start_side: side }),
  };
}
