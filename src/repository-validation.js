export class RepositoryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
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
      "Public Repository URL must not contain credentials",
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

/** @param {unknown} request */
export function normalizeRepositoryRegistration(request) {
  const url = normalizeRepositoryUrl(
    request,
    new Set(["token", "url", "username"]),
  );
  const registration = /** @type {{token?: unknown, username?: unknown}} */ (
    request
  );
  const hasUsername = Object.hasOwn(registration, "username");
  const hasToken = Object.hasOwn(registration, "token");
  if (!hasUsername && !hasToken) {
    return { url };
  }
  if (
    typeof registration.username !== "string" ||
    registration.username.length === 0
  ) {
    fail("repository_username_required", "Repository username is required");
  }
  if (
    typeof registration.token !== "string" ||
    registration.token.length === 0
  ) {
    fail("repository_token_required", "Repository token is required");
  }
  return {
    credential: {
      token: registration.token,
      username: registration.username,
    },
    url,
  };
}
