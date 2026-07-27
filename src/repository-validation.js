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
 * @returns {never}
 */
export function fail(code, message) {
  throw new RepositoryError(code, message);
}

/** @param {unknown} request */
export function normalizePublicRepositoryUrl(request) {
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
    Object.keys(/** @type {object} */ (request)).some((key) => key !== "url")
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
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}
