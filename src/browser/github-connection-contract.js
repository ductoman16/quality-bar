/** @param {Response} response */
async function githubResponseErrorMessage(response) {
  try {
    const body = /** @type {{error?: {message?: unknown}}} */ (
      await response.json()
    );
    if (typeof body.error?.message !== "string") {
      throw new Error("github_error_response_invalid");
    }
    return body.error.message;
  } catch {
    return "GitHub Connection response is invalid";
  }
}

/**
 * @param {URLSearchParams} query
 * @param {(message: string) => void} showError
 */
async function consumeGitHubCallbackFailure(query, showError) {
  const receipt = query.get("github_connection_error");
  if (receipt === null) {
    return false;
  }
  query.delete("github_connection_error");
  history.replaceState(
    null,
    "",
    query.size > 0 ? `/?${query.toString()}` : "/",
  );
  let response;
  try {
    response = await fetch(
      `/api/v1/github-connections/callback-error?receipt=${encodeURIComponent(
        receipt,
      )}`,
    );
  } catch {
    showError("GitHub callback error loading failed");
    return true;
  }
  if (!response.ok) {
    showError(await githubResponseErrorMessage(response));
    return true;
  }
  try {
    const failure = /** @type {unknown} */ (await response.json());
    if (failure === null) {
      return false;
    }
    if (
      !failure ||
      Array.isArray(failure) ||
      typeof failure !== "object" ||
      !("code" in failure) ||
      typeof failure.code !== "string" ||
      !("message" in failure) ||
      typeof failure.message !== "string"
    ) {
      throw new Error("github_callback_error_response_invalid");
    }
    showError(`${failure.message} (${failure.code})`);
    return true;
  } catch {
    showError("GitHub callback error response is invalid");
    return true;
  }
}

/** @param {unknown} verification */
function validGitHubVerificationOutcome(verification) {
  if (!verification || typeof verification !== "object") {
    return false;
  }
  if (!("outcome" in verification) || !("error" in verification)) {
    return false;
  }
  return verification.outcome === "success"
    ? verification.error === null &&
        "api_profile" in verification &&
        typeof verification.api_profile === "string" &&
        "principal" in verification &&
        Boolean(verification.principal) &&
        "permissions" in verification &&
        Boolean(verification.permissions) &&
        "capabilities" in verification &&
        Boolean(verification.capabilities) &&
        "repositories" in verification &&
        Array.isArray(verification.repositories) &&
        verification.repositories.length > 0 &&
        "repository_checks" in verification &&
        Array.isArray(verification.repository_checks) &&
        verification.repository_checks.every(
          (check) =>
            check &&
            typeof check === "object" &&
            "outcome" in check &&
            check.outcome === "success",
        )
    : verification.outcome === "error" &&
        Boolean(
          verification.error &&
          typeof verification.error === "object" &&
          "code" in verification.error &&
          typeof verification.error.code === "string" &&
          "message" in verification.error &&
          typeof verification.error.message === "string" &&
          "repository_id" in verification.error &&
          (verification.error.repository_id === null ||
            Number.isSafeInteger(verification.error.repository_id)),
        );
}

/** @param {unknown} value */
function validGitHubConnection(value) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !("principal" in value) ||
    !value.principal ||
    typeof value.principal !== "object" ||
    !("login" in value.principal) ||
    typeof value.principal.login !== "string" ||
    !("api_profile" in value) ||
    typeof value.api_profile !== "string" ||
    !("permissions" in value) ||
    !value.permissions ||
    Array.isArray(value.permissions) ||
    typeof value.permissions !== "object" ||
    Object.values(value.permissions).some(
      (permission) => typeof permission !== "string",
    ) ||
    Object.keys(value.permissions).length === 0 ||
    !("capabilities" in value) ||
    !value.capabilities ||
    Array.isArray(value.capabilities) ||
    typeof value.capabilities !== "object" ||
    Object.values(value.capabilities).some((state) => state !== "verified") ||
    Object.keys(value.capabilities).length === 0 ||
    !("health" in value) ||
    !["healthy", "error"].includes(/** @type {string} */ (value.health)) ||
    !("lifecycle" in value) ||
    !["enabled", "retired"].includes(/** @type {string} */ (value.lifecycle)) ||
    !("health_error" in value) ||
    !("polling" in value) ||
    !Array.isArray(value.polling) ||
    !value.polling.every(validGitHubPollingState) ||
    !("polling_failure" in value) ||
    !(
      value.polling_failure === null ||
      validGitHubPollingFailure(value.polling_failure)
    ) ||
    !("repository_count" in value) ||
    !Number.isSafeInteger(value.repository_count) ||
    !("verified_at" in value) ||
    !Number.isSafeInteger(value.verified_at) ||
    !("verification_history" in value) ||
    !Array.isArray(value.verification_history) ||
    value.verification_history.length === 0
  ) {
    return false;
  }
  const healthError =
    value.health_error &&
    typeof value.health_error === "object" &&
    "code" in value.health_error &&
    typeof value.health_error.code === "string" &&
    "message" in value.health_error &&
    typeof value.health_error.message === "string";
  return (
    ((value.health === "healthy" && value.health_error === null) ||
      (value.health === "error" && healthError)) &&
    value.verification_history.every(validGitHubVerification)
  );
}

/** @param {any} state */
function validGitHubPollingState(state) {
  const validError =
    state?.error &&
    typeof state.error.code === "string" &&
    typeof state.error.message === "string";
  return Boolean(
    state &&
    ["complete", "error", "pending"].includes(state.baseline_status) &&
    Number.isSafeInteger(state.forge_repository_id) &&
    (state.last_success_at === null ||
      Number.isSafeInteger(state.last_success_at)) &&
    (state.next_attempt_at === null ||
      Number.isSafeInteger(state.next_attempt_at)) &&
    (state.rate_gate_until === null ||
      Number.isSafeInteger(state.rate_gate_until)) &&
    ((state.baseline_status === "complete" &&
      Number.isSafeInteger(state.last_success_at) &&
      (state.error === null || validError)) ||
      (state.baseline_status === "error" && validError) ||
      (state.baseline_status === "pending" &&
        state.error === null &&
        state.last_success_at === null)),
  );
}

/** @param {any} state */
function githubPollingText(state) {
  const success =
    state.last_success_at === null
      ? "no successful baseline"
      : `last success ${githubVerificationTime(state.last_success_at)}`;
  const error =
    state.error === null
      ? ""
      : `; ${state.error.message} (${state.error.code})`;
  const rate =
    state.rate_gate_until === null
      ? ""
      : `; rate gate until ${githubVerificationTime(state.rate_gate_until)}`;
  const next =
    state.next_attempt_at === null
      ? "after correction"
      : githubVerificationTime(state.next_attempt_at);
  return `Forge Repository ${state.forge_repository_id}; baseline ${state.baseline_status}; ${success}${error}${rate}; next attempt ${next}`;
}

/** @param {any} failure */
function validGitHubPollingFailure(failure) {
  return Boolean(
    failure &&
    typeof failure === "object" &&
    failure.error &&
    typeof failure.error === "object" &&
    typeof failure.error.code === "string" &&
    typeof failure.error.message === "string" &&
    (failure.forge_repository_id === null ||
      Number.isSafeInteger(failure.forge_repository_id)) &&
    (failure.next_attempt_at === null ||
      Number.isSafeInteger(failure.next_attempt_at)) &&
    (failure.rate_gate_until === null ||
      Number.isSafeInteger(failure.rate_gate_until)),
  );
}

/** @param {any} failure */
function githubPollingFailureText(failure) {
  const owner =
    failure.forge_repository_id === null
      ? "Connection"
      : `Forge Repository ${failure.forge_repository_id}`;
  const rate =
    failure.rate_gate_until === null
      ? ""
      : `; rate gate until ${githubVerificationTime(failure.rate_gate_until)}`;
  const next =
    failure.next_attempt_at === null
      ? "after correction"
      : githubVerificationTime(failure.next_attempt_at);
  return `${owner} baseline error; ${failure.error.message} (${failure.error.code})${rate}; next attempt ${next}`;
}

/** @param {unknown} verification */
function validGitHubVerification(verification) {
  return Boolean(
    verification &&
    typeof verification === "object" &&
    "id" in verification &&
    typeof verification.id === "string" &&
    verification.id.length > 0 &&
    "trigger" in verification &&
    typeof verification.trigger === "string" &&
    validGitHubVerificationOutcome(verification) &&
    "affected_repository_ids" in verification &&
    Array.isArray(verification.affected_repository_ids) &&
    verification.affected_repository_ids.length > 0 &&
    verification.affected_repository_ids.every(
      (id) => Number.isSafeInteger(id) && id > 0,
    ) &&
    "api_profile" in verification &&
    (verification.api_profile === null ||
      typeof verification.api_profile === "string") &&
    "principal" in verification &&
    (verification.principal === null ||
      (typeof verification.principal === "object" &&
        "login" in verification.principal &&
        typeof verification.principal.login === "string")) &&
    "repositories" in verification &&
    Array.isArray(verification.repositories) &&
    verification.repositories.every(validGitHubRepositoryEvidence) &&
    "repository_checks" in verification &&
    Array.isArray(verification.repository_checks) &&
    verification.repository_checks.length ===
      verification.affected_repository_ids.length &&
    verification.repository_checks.every(validGitHubRepositoryCheck) &&
    "verified_at" in verification &&
    Number.isSafeInteger(verification.verified_at),
  );
}

/** @param {unknown} repository */
function validGitHubRepositoryEvidence(repository) {
  return Boolean(
    repository &&
    typeof repository === "object" &&
    "id" in repository &&
    Number.isSafeInteger(repository.id) &&
    /** @type {number} */ (repository.id) > 0 &&
    "full_name" in repository &&
    typeof repository.full_name === "string" &&
    "private" in repository &&
    typeof repository.private === "boolean",
  );
}

/** @param {unknown} check */
function validGitHubRepositoryCheck(check) {
  return Boolean(
    check &&
    typeof check === "object" &&
    "repository_id" in check &&
    Number.isSafeInteger(check.repository_id) &&
    /** @type {number} */ (check.repository_id) > 0 &&
    "outcome" in check &&
    ["success", "error", "not_completed"].includes(
      /** @type {string} */ (check.outcome),
    ),
  );
}

/** @param {number} timestamp */
function githubVerificationTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    throw new Error("github_connection_response_invalid");
  }
  return value.toISOString();
}

/** @param {{affected_repository_ids: number[], api_profile: string | null, error: null | {code: string, message: string, repository_id: number | null}, outcome: string, principal: null | {login: string}, repositories: unknown[], repository_checks: {outcome: string, repository_id: number}[], trigger: string, verified_at: number}} verification */
function githubVerificationHistoryText(verification) {
  const error =
    verification.outcome === "error"
      ? `; ${verification.error?.message} (${verification.error?.code})${
          verification.error?.repository_id === null
            ? ""
            : `; Repository ${verification.error?.repository_id}`
        }`
      : "";
  const checks = verification.repository_checks
    .map((check) => `${check.repository_id}: ${check.outcome}`)
    .join(", ");
  return `${verification.trigger}; ${verification.outcome}${error}; Repository checks ${checks}; ${verification.repositories.length} enumerated Repositories; ${githubVerificationTime(verification.verified_at)}`;
}

Reflect.set(
  window,
  "qualityBarGitHubConnectionContract",
  Object.freeze({
    consumeCallbackFailure: consumeGitHubCallbackFailure,
    historyText: githubVerificationHistoryText,
    pollingFailureText: githubPollingFailureText,
    pollingText: githubPollingText,
    responseErrorMessage: githubResponseErrorMessage,
    validConnection: validGitHubConnection,
    validOutcome: validGitHubVerificationOutcome,
    verificationTime: githubVerificationTime,
  }),
);
