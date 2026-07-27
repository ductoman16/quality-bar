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
    ? verification.error === null
    : verification.outcome === "error" &&
        Boolean(
          verification.error &&
          typeof verification.error === "object" &&
          "code" in verification.error &&
          typeof verification.error.code === "string" &&
          "message" in verification.error &&
          typeof verification.error.message === "string",
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

/** @param {{api_profile: string, error: null | {code: string, message: string}, outcome: string, principal: {login: string}, repositories: unknown[], trigger: string, verified_at: number}} verification */
function githubVerificationHistoryText(verification) {
  const error =
    verification.outcome === "error"
      ? `; ${verification.error?.message} (${verification.error?.code})`
      : "";
  return `${verification.trigger}; ${verification.outcome}${error}; ${verification.api_profile}; ${verification.principal.login}; ${verification.repositories.length} Repositories; ${githubVerificationTime(verification.verified_at)}`;
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
