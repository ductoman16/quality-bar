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
function validPermissions(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const permissions = /** @type {Record<string, unknown>} */ (value);
  return (
    Object.keys(permissions).sort().join(",") === "admin,pull,push" &&
    permissions.admin === true &&
    permissions.pull === true &&
    permissions.push === true
  );
}

/** @param {unknown} value */
function validUri(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    return new URL(value).toString().length > 0;
  } catch {
    return false;
  }
}

/** @param {Record<string, unknown>} check */
function validFailedRepositoryCheck(check) {
  const hasPermissions = "permissions" in check;
  const keys =
    check.outcome === "error"
      ? [
          "error",
          "forge_repository_id",
          "outcome",
          ...(hasPermissions ? ["permissions"] : []),
        ]
      : [
          "forge_repository_id",
          "outcome",
          ...(hasPermissions ? ["permissions"] : []),
        ];
  const error =
    check.error &&
    !Array.isArray(check.error) &&
    typeof check.error === "object"
      ? /** @type {Record<string, unknown>} */ (check.error)
      : null;
  return (
    ["error", "not_completed"].includes(
      /** @type {string} */ (check.outcome),
    ) &&
    Object.keys(check).sort().join(",") === keys.join(",") &&
    Number.isSafeInteger(check.forge_repository_id) &&
    Number(check.forge_repository_id) > 0 &&
    (!hasPermissions || validPermissions(check.permissions)) &&
    (check.outcome === "not_completed" ||
      (error !== null &&
        Object.keys(error).sort().join(",") === "code,message" &&
        typeof error.code === "string" &&
        error.code.length > 0 &&
        typeof error?.message === "string" &&
        error.message.length > 0))
  );
}

/** @param {unknown} value */
function validRepositoryCheck(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const check = /** @type {Record<string, unknown>} */ (value);
  if (check.outcome !== "success") {
    return validFailedRepositoryCheck(check);
  }
  const hasPermissions = "permissions" in check;
  return (
    hasPermissions &&
    Object.keys(check).sort().join(",") ===
      "api_url,clone_url,full_name,html_url,id,outcome,permissions,private" &&
    Number.isSafeInteger(check.id) &&
    Number(check.id) > 0 &&
    ["api_url", "clone_url", "html_url"].every((field) =>
      validUri(check[field]),
    ) &&
    typeof check.full_name === "string" &&
    check.full_name.length > 0 &&
    typeof check.private === "boolean" &&
    validPermissions(check.permissions)
  );
}

/** @param {unknown} value */
function validPrincipal(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const principal = /** @type {Record<string, unknown>} */ (value);
  return (
    Object.keys(principal).sort().join(",") === "id,login" &&
    Number.isSafeInteger(principal.id) &&
    Number(principal.id) > 0 &&
    typeof principal.login === "string" &&
    principal.login.length > 0
  );
}

/** @param {unknown} value */
function validCapabilities(value) {
  return Boolean(value && !Array.isArray(value) && typeof value === "object");
}

/** @param {unknown} value */
function validScopes(value) {
  return (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === "string" && scope.length > 0)
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
    Object.keys(verification).sort().join(",") ===
      "api_profile,capabilities,error,id,outcome,principal,reported_version,repositories,scopes,trigger,verified_at" &&
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
        verification.repositories.every(
          (repository) => repository.outcome === "success",
        ) &&
        verification.api_profile === "forgejo-v16" &&
        typeof verification.reported_version === "string" &&
        /^16\./.test(verification.reported_version) &&
        validPrincipal(verification.principal) &&
        validScopes(verification.scopes) &&
        validCapabilities(verification.capabilities)
      : error !== null &&
        Object.keys(error).sort().join(",") === "code,message" &&
        typeof error.code === "string" &&
        error.code.length > 0 &&
        typeof error.message === "string" &&
        error.message.length > 0 &&
        (verification.api_profile === null ||
          verification.api_profile === "forgejo-v16") &&
        (verification.reported_version === null ||
          (typeof verification.reported_version === "string" &&
            /^16\./.test(verification.reported_version))) &&
        (verification.principal === null ||
          validPrincipal(verification.principal)) &&
        (verification.scopes === null || validScopes(verification.scopes)) &&
        (verification.capabilities === null ||
          validCapabilities(verification.capabilities)))
  );
}

/** @param {unknown} value */
function validForgejoPollingError(value) {
  const error =
    value && !Array.isArray(value) && typeof value === "object"
      ? /** @type {Record<string, unknown>} */ (value)
      : null;
  return Boolean(
    error &&
    Object.keys(error).sort().join(",") === "code,message" &&
    typeof error.code === "string" &&
    error.code.length > 0 &&
    typeof error.message === "string" &&
    error.message.length > 0,
  );
}

/** @param {unknown} value */
function validForgejoPollingState(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const state = /** @type {Record<string, unknown>} */ (value);
  const validError =
    state.error === null || validForgejoPollingError(state.error);
  return (
    Object.keys(state).sort().join(",") ===
      "baseline_status,error,forge_repository_id,last_success_at,next_attempt_at,rate_gate_until" &&
    ["complete", "error", "pending"].includes(
      /** @type {string} */ (state.baseline_status),
    ) &&
    Number.isSafeInteger(state.forge_repository_id) &&
    Number(state.forge_repository_id) > 0 &&
    (state.last_success_at === null ||
      Number.isSafeInteger(state.last_success_at)) &&
    (state.next_attempt_at === null ||
      Number.isSafeInteger(state.next_attempt_at)) &&
    (state.rate_gate_until === null ||
      Number.isSafeInteger(state.rate_gate_until)) &&
    validError &&
    ((state.baseline_status === "complete" &&
      Number.isSafeInteger(state.last_success_at)) ||
      (state.baseline_status === "error" &&
        validForgejoPollingError(state.error)) ||
      (state.baseline_status === "pending" &&
        state.error === null &&
        Number.isSafeInteger(state.next_attempt_at)))
  );
}

/** @param {unknown} value */
function validForgejoPollingFailure(value) {
  if (value === null) {
    return true;
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const failure = /** @type {Record<string, unknown>} */ (value);
  return (
    Object.keys(failure).sort().join(",") ===
      "error,forge_repository_id,next_attempt_at,rate_gate_until" &&
    validForgejoPollingError(failure.error) &&
    (failure.forge_repository_id === null ||
      (Number.isSafeInteger(failure.forge_repository_id) &&
        Number(failure.forge_repository_id) > 0)) &&
    (failure.next_attempt_at === null ||
      Number.isSafeInteger(failure.next_attempt_at)) &&
    (failure.rate_gate_until === null ||
      Number.isSafeInteger(failure.rate_gate_until))
  );
}

/** @param {number | null} timestamp @param {string} absent */
function forgejoPollingTime(timestamp, absent) {
  return timestamp === null ? absent : new Date(timestamp).toISOString();
}

/** @param {any} state */
function forgejoPollingText(state) {
  const success = forgejoPollingTime(
    state.last_success_at,
    "no successful baseline",
  );
  const error =
    state.error === null
      ? ""
      : `; ${state.error.message} (${state.error.code})`;
  const rate =
    state.rate_gate_until === null
      ? ""
      : `; rate gate until ${forgejoPollingTime(state.rate_gate_until, "")}`;
  const next = forgejoPollingTime(
    state.next_attempt_at,
    "after operator correction",
  );
  return `Forge Repository ${state.forge_repository_id}; baseline ${state.baseline_status}; ${success}${error}${rate}; next attempt ${next}`;
}

/** @param {any} failure */
function forgejoPollingFailureText(failure) {
  const owner =
    failure.forge_repository_id === null
      ? "Connection"
      : `Forge Repository ${failure.forge_repository_id}`;
  const rate =
    failure.rate_gate_until === null
      ? ""
      : `; rate gate until ${forgejoPollingTime(failure.rate_gate_until, "")}`;
  const next = forgejoPollingTime(
    failure.next_attempt_at,
    "after operator correction",
  );
  return `${owner} baseline error; ${failure.error.message} (${failure.error.code})${rate}; next attempt ${next}`;
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
    Array.isArray(connection.polling) &&
    connection.polling.every(validForgejoPollingState) &&
    validForgejoPollingFailure(connection.polling_failure) &&
    Array.isArray(connection.verification_history) &&
    connection.verification_history.length > 0 &&
    connection.verification_history.every(validForgejoVerification) &&
    Number.isSafeInteger(connection.verified_at) &&
    Object.keys(connection).length === 14
  );
}

/** @param {any} verification */
function forgejoVerificationText(verification) {
  const time = new Date(verification.verified_at).toISOString();
  const principal = verification.principal
    ? `Repository owner: ${verification.principal.login} (${verification.principal.id})`
    : "Repository owner: not completed";
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
  forgejoPollingFailureText,
  forgejoPollingText,
  forgejoResponseErrorMessage,
  forgejoVerificationText,
  validForgejoConnection,
});
