/** @param {Response} response */
async function forgejoResponseErrorMessage(response) {
  const body = /** @type {unknown} */ (await response.json());
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    !("error" in body) ||
    !body.error ||
    Array.isArray(body.error) ||
    typeof body.error !== "object" ||
    !("message" in body.error) ||
    typeof body.error.message !== "string" ||
    body.error.message.length === 0
  ) {
    throw new Error("Forgejo error response is invalid");
  }
  return body.error.message;
}

/** @param {unknown} error */
function forgejoErrorMessage(error) {
  if (!(error instanceof Error)) {
    throw error;
  }
  return error.message;
}

/** @param {unknown} value */
function validRepositoryCheck(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const check = /** @type {Record<string, unknown>} */ (value);
  const error =
    check.error &&
    !Array.isArray(check.error) &&
    typeof check.error === "object"
      ? /** @type {Record<string, unknown>} */ (check.error)
      : null;
  return (
    ["success", "error", "not_completed"].includes(
      /** @type {string} */ (check.outcome),
    ) &&
    (Number.isSafeInteger(check.id) ||
      Number.isSafeInteger(check.forge_repository_id)) &&
    (check.outcome !== "error" ||
      (typeof error?.code === "string" &&
        error.code.length > 0 &&
        typeof error.message === "string" &&
        error.message.length > 0))
  );
}

/** @param {unknown} value */
function validForgejoVerification(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const verification = /** @type {Record<string, unknown>} */ (value);
  const error =
    verification.error &&
    typeof verification.error === "object" &&
    !Array.isArray(verification.error)
      ? /** @type {Record<string, unknown>} */ (verification.error)
      : null;
  return (
    typeof verification.id === "string" &&
    verification.id.length > 0 &&
    typeof verification.trigger === "string" &&
    ["success", "error"].includes(
      /** @type {string} */ (verification.outcome),
    ) &&
    Number.isSafeInteger(verification.verified_at) &&
    Array.isArray(verification.repositories) &&
    verification.repositories.every(validRepositoryCheck) &&
    (verification.outcome === "success"
      ? verification.error === null &&
        verification.api_profile === "forgejo-v16" &&
        typeof verification.reported_version === "string" &&
        /^16\./.test(verification.reported_version) &&
        verification.principal !== null &&
        typeof verification.principal === "object" &&
        Array.isArray(verification.scopes) &&
        verification.capabilities !== null &&
        typeof verification.capabilities === "object" &&
        !Array.isArray(verification.capabilities)
      : typeof error?.code === "string" &&
        error.code.length > 0 &&
        typeof error.message === "string" &&
        error.message.length > 0)
  );
}

/** @param {unknown} value */
function validForgejoConnection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const connection = /** @type {Record<string, unknown>} */ (value);
  const principal =
    connection.principal &&
    typeof connection.principal === "object" &&
    !Array.isArray(connection.principal)
      ? /** @type {Record<string, unknown>} */ (connection.principal)
      : null;
  const healthError =
    connection.health_error &&
    typeof connection.health_error === "object" &&
    !Array.isArray(connection.health_error)
      ? /** @type {Record<string, unknown>} */ (connection.health_error)
      : null;
  return (
    connection.api_profile === "forgejo-v16" &&
    typeof connection.base_url === "string" &&
    connection.base_url.length > 0 &&
    connection.capabilities !== null &&
    typeof connection.capabilities === "object" &&
    !Array.isArray(connection.capabilities) &&
    ((connection.health === "healthy" && connection.health_error === null) ||
      (connection.health === "error" &&
        typeof healthError?.code === "string" &&
        healthError.code.length > 0 &&
        typeof healthError.message === "string" &&
        healthError.message.length > 0)) &&
    typeof connection.id === "string" &&
    connection.id.length > 0 &&
    ["enabled", "retired"].includes(
      /** @type {string} */ (connection.lifecycle),
    ) &&
    Number.isSafeInteger(principal?.id) &&
    typeof principal?.login === "string" &&
    principal.login.length > 0 &&
    typeof connection.reported_version === "string" &&
    /^16\./.test(connection.reported_version) &&
    Array.isArray(connection.scopes) &&
    connection.scopes.every((scope) => typeof scope === "string") &&
    Array.isArray(connection.verification_history) &&
    connection.verification_history.length > 0 &&
    connection.verification_history.every(validForgejoVerification) &&
    Number.isSafeInteger(connection.verified_at) &&
    Object.keys(connection).length === 12
  );
}

/** @param {any} verification */
function forgejoVerificationText(verification) {
  const time = new Date(verification.verified_at).toISOString();
  const principal = verification.principal
    ? `principal: ${verification.principal.login} (${verification.principal.id})`
    : "principal: not completed";
  const scopes = verification.scopes
    ? `required authorities: ${verification.scopes.join(", ")}`
    : "required authorities: not completed";
  const capabilities = verification.capabilities
    ? Object.entries(verification.capabilities)
        .map(([name, outcome]) => `${name.replaceAll("_", " ")}: ${outcome}`)
        .join(", ")
    : "capabilities: not completed";
  const repositories = verification.repositories
    .map((/** @type {any} */ repository) => {
      const identity =
        repository.full_name ??
        `Forge Repository ${repository.id ?? repository.forge_repository_id}`;
      const outcome =
        repository.outcome === "error"
          ? `error: ${repository.error.message} (${repository.error.code})`
          : repository.outcome;
      return `${identity}: ${outcome}`;
    })
    .join(", ");
  const error =
    verification.error === null
      ? ""
      : `; ${verification.error.message} (${verification.error.code})`;
  return `${verification.trigger}; ${time}; ${verification.api_profile ?? "profile not completed"}; ${verification.reported_version ?? "version not completed"}; ${principal}; ${scopes}; ${capabilities}; Repositories: ${repositories}${error}`;
}

Reflect.set(window, "qualityBarForgejoConnectionContract", {
  forgejoErrorMessage,
  forgejoResponseErrorMessage,
  forgejoVerificationText,
  validForgejoConnection,
});
