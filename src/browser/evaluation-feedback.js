/** @param {any} error */
function validError(error) {
  return (
    error === null ||
    (typeof error?.code === "string" &&
      error.code.length > 0 &&
      typeof error.detail === "string" &&
      error.detail.length > 0)
  );
}

/** @param {any} publication @param {string[]} statuses */
function validPublication(publication, statuses) {
  if (
    !publication ||
    !statuses.includes(publication.publication_status) ||
    !validError(publication.error)
  ) {
    return false;
  }
  if (["aggregate_only", "waiting"].includes(publication.publication_status)) {
    return (
      publication.external_id === null &&
      publication.published_at === null &&
      publication.error === null
    );
  }
  if (publication.publication_status === "succeeded") {
    return (
      Number.isSafeInteger(publication.external_id) &&
      typeof publication.published_at === "string" &&
      publication.error === null
    );
  }
  return (
    publication.external_id === null &&
    publication.published_at === null &&
    publication.error !== null
  );
}

/** @param {any} feedback */
function valid(feedback) {
  return (
    feedback === undefined ||
    (feedback &&
      validPublication(feedback.aggregate, [
        "waiting",
        "succeeded",
        "unavailable",
      ]) &&
      Array.isArray(feedback.findings) &&
      feedback.findings.every(
        (/** @type {any} */ finding) =>
          typeof finding?.finding_id === "string" &&
          validPublication(finding, [
            "aggregate_only",
            "waiting",
            "succeeded",
            "unavailable",
          ]),
      ))
  );
}

/** @param {any} feedback */
function hasUnavailable(feedback) {
  return Boolean(
    feedback?.aggregate.publication_status === "unavailable" ||
    feedback?.findings.some(
      (/** @type {any} */ finding) =>
        finding.publication_status === "unavailable",
    ),
  );
}

/** @param {any} row @param {any} feedback */
function render(row, feedback) {
  const aggregate = document.createElement("div");
  aggregate.setAttribute("aria-live", "polite");
  aggregate.setAttribute("role", "status");
  aggregate.textContent =
    "Aggregate feedback — " +
    feedback.aggregate.publication_status +
    (feedback.aggregate.error
      ? " — Error " +
        feedback.aggregate.error.code +
        ": " +
        feedback.aggregate.error.detail
      : feedback.aggregate.external_id !== null
        ? " — GitHub comment " +
          feedback.aggregate.external_id +
          " — Published " +
          feedback.aggregate.published_at
        : "");
  row.append(aggregate);
  for (const finding of feedback.findings) {
    const findingState = document.createElement("div");
    findingState.setAttribute("aria-live", "polite");
    findingState.setAttribute("role", "status");
    findingState.textContent =
      "Finding " +
      finding.finding_id +
      " inline feedback — " +
      (finding.publication_status === "aggregate_only"
        ? "aggregate-only"
        : finding.publication_status) +
      (finding.error
        ? " — Error " + finding.error.code + ": " + finding.error.detail
        : finding.external_id !== null
          ? " — GitHub comment " +
            finding.external_id +
            " — Published " +
            finding.published_at
          : "");
    row.append(findingState);
  }
}

Reflect.set(window, "qualityBarEvaluationFeedback", {
  hasUnavailable,
  render,
  valid,
});
