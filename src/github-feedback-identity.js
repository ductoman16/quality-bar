/** @param {unknown} body @param {"Adjudication" | "Evaluation" | "Finding"} label */
export function githubFeedbackSourceIdentity(body, label) {
  if (typeof body !== "string") {
    return null;
  }
  const prefix = `${label}: \``;
  const lines = body.split("\n");
  const firstFinding = lines.findIndex((line) =>
    line.startsWith("### Finding"),
  );
  const candidates =
    body.startsWith("## Quality Bar Evaluation\n") && firstFinding !== -1
      ? lines.slice(0, firstFinding)
      : lines;
  const line = candidates.findLast((candidate) => candidate.startsWith(prefix));
  return line?.endsWith("`") && line.length > prefix.length + 1
    ? line.slice(prefix.length, -1)
    : null;
}
