export class RepositoryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {unavailable?: boolean}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
    if (options?.unavailable === true) {
      this.unavailable = true;
    }
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
export function fail(code, message, cause) {
  throw new RepositoryError(code, message, { cause });
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
export function failUnavailable(code, message, cause) {
  throw new RepositoryError(code, message, { cause, unavailable: true });
}

/**
 * @param {unknown} request
 * @param {Set<string>} allowedKeys
 */
function normalizeRepositoryUrl(request, allowedKeys) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !("url" in request) ||
    typeof request.url !== "string" ||
    request.url.trim().length === 0
  ) {
    fail("repository_url_required", "Repository HTTPS URL is required");
  }
  if (
    Object.keys(/** @type {object} */ (request)).some(
      (key) => !allowedKeys.has(key),
    )
  ) {
    fail(
      "repository_request_invalid",
      "Repository registration request is invalid",
    );
  }

  /** @type {URL} */
  let url;
  try {
    url = new URL(request.url);
  } catch {
    fail("repository_url_invalid", "Repository HTTPS URL is invalid");
  }
  if (url.protocol !== "https:") {
    fail(
      "repository_transport_unsupported",
      "Only HTTPS Repository transport is supported",
    );
  }
  if (url.username || url.password) {
    fail(
      "repository_credentials_unsupported",
      "Repository URL must not contain credentials",
    );
  }
  if (url.search || url.hash) {
    fail("repository_url_invalid", "Repository HTTPS URL is invalid");
  }
  url.pathname = url.pathname.replaceAll(/%[0-9A-Fa-f]{2}/g, (encodedByte) => {
    const character = String.fromCodePoint(
      Number.parseInt(encodedByte.slice(1), 16),
    );
    return /^[A-Za-z0-9._~-]$/.test(character)
      ? character
      : encodedByte.toUpperCase();
  });
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}

/** @param {unknown} request */
export function normalizePublicRepositoryUrl(request) {
  return normalizeRepositoryUrl(request, new Set(["url"]));
}

/** @param {{token?: unknown, username?: unknown}} request */
function normalizeCredential(request) {
  if (typeof request.username !== "string" || request.username.length === 0) {
    fail("repository_username_required", "Repository username is required");
  }
  if (typeof request.token !== "string" || request.token.length === 0) {
    fail("repository_token_required", "Repository token is required");
  }
  return {
    token: request.token,
    username: request.username,
  };
}

/** @param {unknown} request */
export function normalizeRepositoryRegistration(request) {
  const url = normalizeRepositoryUrl(
    request,
    new Set(["token", "url", "username"]),
  );
  const registration = /** @type {{token?: unknown, username?: unknown}} */ (
    request
  );
  if (
    !Object.hasOwn(registration, "username") &&
    !Object.hasOwn(registration, "token")
  ) {
    return { url };
  }
  return { credential: normalizeCredential(registration), url };
}

/** @param {unknown} request */
export function normalizeRepositoryCredentialRotation(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some((key) => !new Set(["token", "username"]).has(key))
  ) {
    fail(
      "repository_request_invalid",
      "Repository credential rotation request is invalid",
    );
  }
  return normalizeCredential(
    /** @type {{token?: unknown, username?: unknown}} */ (request),
  );
}

/** @param {unknown} request */
export function normalizeRepositoryLifecycleChange(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !("lifecycle" in request) ||
    typeof request.lifecycle !== "string" ||
    request.lifecycle.length === 0
  ) {
    fail("repository_lifecycle_required", "Repository lifecycle is required");
  }
  if (Object.keys(request).some((key) => key !== "lifecycle")) {
    fail(
      "repository_lifecycle_request_invalid",
      "Repository lifecycle request is invalid",
    );
  }
  if (!["enabled", "disabled", "retired"].includes(request.lifecycle)) {
    fail(
      "repository_lifecycle_invalid",
      "Repository lifecycle must be enabled, disabled, or retired",
    );
  }
  return {
    lifecycle: /** @type {"enabled" | "disabled" | "retired"} */ (
      request.lifecycle
    ),
  };
}

/**
 * @param {{
 *   health: "healthy" | "error",
 *   healthError: null | {code: string, message: string},
 *   lifecycle: "enabled" | "disabled" | "retired"
 * }} repository
 */
export function assertRepositoryAcceptsNewWork(repository) {
  if (repository.lifecycle === "disabled") {
    fail("repository_disabled", "Repository is disabled");
  }
  if (repository.lifecycle === "retired") {
    fail("repository_retired", "Repository is retired");
  }
  if (repository.health === "error") {
    if (!repository.healthError) {
      throw new TypeError("Repository health error is unavailable");
    }
    failUnavailable(
      repository.healthError.code,
      repository.healthError.message,
    );
  }
}
