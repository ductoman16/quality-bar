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

/** @param {any} publication */
function validDelivery(publication) {
  return (
    typeof publication.source_identity === "string" &&
    publication.source_identity.length > 0 &&
    typeof publication.target === "string" &&
    publication.target.length > 0 &&
    Number.isSafeInteger(publication.attempt_count) &&
    publication.attempt_count >= 0 &&
    (publication.last_attempt_at === null ||
      typeof publication.last_attempt_at === "string") &&
    (publication.next_attempt_at === null ||
      typeof publication.next_attempt_at === "string") &&
    (publication.provider_gate_until === null ||
      typeof publication.provider_gate_until === "string") &&
    typeof publication.reconciliation_required === "boolean"
  );
}

/** @param {any} status @param {string} head */
function validCommitStatus(status, head) {
  if (status === undefined) {
    return true;
  }
  return (
    validDelivery(status) &&
    status.context === "Quality Bar" &&
    status.head_commit === head &&
    (status.external_id === null || Number.isSafeInteger(status.external_id)) &&
    ["pending", "success", "failure", "error"].includes(status.state) &&
    ["waiting", "succeeded", "unavailable"].includes(
      status.publication_status,
    ) &&
    (status.published_at === null || typeof status.published_at === "string") &&
    validError(status.error) &&
    ((status.publication_status === "waiting" &&
      status.published_at === null) ||
      (status.publication_status === "succeeded" &&
        typeof status.published_at === "string" &&
        status.error === null) ||
      (status.publication_status === "unavailable" &&
        status.published_at === null &&
        status.error !== null))
  );
}

/** @param {any} publication */
function deliveryText(publication) {
  return (
    " — Source " +
    publication.source_identity +
    " — Target " +
    publication.target +
    " — Attempts " +
    publication.attempt_count +
    (publication.last_attempt_at
      ? " — Last attempt " + publication.last_attempt_at
      : "") +
    (publication.reconciliation_required ? " — Reconciliation required" : "") +
    (publication.provider_gate_until
      ? " — Provider gate until " + publication.provider_gate_until
      : "") +
    (publication.next_attempt_at
      ? " — Next attempt " + publication.next_attempt_at
      : "")
  );
}

/** @param {any} publication @param {string[]} statuses */
function validPublication(publication, statuses) {
  if (
    !publication ||
    !statuses.includes(publication.publication_status) ||
    !validError(publication.error) ||
    !validDelivery(publication)
  ) {
    return false;
  }
  if (publication.publication_status === "aggregate_only") {
    return (
      publication.external_id === null &&
      publication.published_at === null &&
      publication.error === null
    );
  }
  if (publication.publication_status === "waiting") {
    return (
      publication.external_id === null && publication.published_at === null
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
    feedback?.aggregate.error ||
    feedback?.aggregate.reconciliation_required ||
    feedback?.findings.some(
      (/** @type {any} */ finding) =>
        finding.publication_status === "unavailable" ||
        finding.error ||
        finding.reconciliation_required,
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
    deliveryText(feedback.aggregate) +
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
      deliveryText(finding) +
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
  validCommitStatus,
});
