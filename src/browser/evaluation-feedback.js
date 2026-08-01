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
    (publication.connection_identity === null ||
      (typeof publication.connection_identity === "string" &&
        publication.connection_identity.length > 0)) &&
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
    validError(publication.provider_gate_error) &&
    ((publication.provider_gate_until === null &&
      publication.provider_gate_error === null) ||
      (typeof publication.provider_gate_until === "string" &&
        publication.provider_gate_error !== null)) &&
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
    (publication.provider_gate_error
      ? " — Provider gate error " +
        publication.provider_gate_error.code +
        ": " +
        publication.provider_gate_error.detail
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

/** @param {any} evaluation */
function correction(evaluation) {
  const unavailable = [
    evaluation.commit_status,
    evaluation.feedback?.aggregate,
    ...(evaluation.feedback?.findings ?? []),
  ].find((publication) => publication?.publication_status === "unavailable");
  if (!unavailable) {
    return null;
  }
  const connectionOwned =
    [
      "github_app_profile_mismatch",
      "github_connection_credential_invalid",
      "github_connection_credential_undecryptable",
      "github_connection_retired",
      "github_installation_scope_invalid",
      "github_permissions_mismatch",
      "github_principal_mismatch",
      "forgejo_api_request_failed",
      "forgejo_api_response_invalid",
      "forgejo_api_unavailable",
      "forgejo_connection_credential_undecryptable",
      "forgejo_connection_retired",
      "forgejo_credential_undecryptable",
      "forgejo_publication_capability_unavailable",
    ].includes(unavailable.error.code) ||
    (unavailable.error.code === "github_api_request_failed" &&
      [
        "GitHub API request failed with HTTP 401",
        "GitHub API request failed with HTTP 403",
      ].includes(unavailable.error.detail));
  const forgejoConnectionOwned = unavailable.error.code.startsWith("forgejo_");
  return connectionOwned && unavailable.connection_identity
    ? {
        href: forgejoConnectionOwned
          ? "/?view=repositories#forgejo-connection-details"
          : "/?view=repositories#github-connection-details",
        text:
          (forgejoConnectionOwned ? "Forgejo" : "GitHub") +
          " Connection " +
          unavailable.connection_identity,
      }
    : {
        href:
          "/?view=repositories#repository-" +
          encodeURIComponent(evaluation.repository.id),
        text: "Repository " + evaluation.repository.id,
      };
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
        ? " — comment " +
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
          ? " — comment " +
            finding.external_id +
            " — Published " +
            finding.published_at
          : "");
    row.append(findingState);
  }
}

Reflect.set(window, "qualityBarEvaluationFeedback", {
  correction,
  hasUnavailable,
  render,
  valid,
  validCommitStatus,
});
