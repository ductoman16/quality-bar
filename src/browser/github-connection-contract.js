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
    responseErrorMessage: githubResponseErrorMessage,
    validOutcome: validGitHubVerificationOutcome,
    verificationTime: githubVerificationTime,
  }),
);
