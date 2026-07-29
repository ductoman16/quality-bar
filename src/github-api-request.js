import { GitHubConnectionError } from "./github-connection-error.js";

const API_VERSION = "2026-03-10";

/** @param {string} code @param {string} message @param {{affectedRepositoryIds?: number[], cause?: unknown, nextAttemptAt?: number, repositoryId?: number}} [options] @returns {never} */
function fail(code, message, options) {
  throw new GitHubConnectionError(code, message, options);
}

/** @param {Headers} headers @param {number} requestedAt */
function providerNextAttemptAt(headers, requestedAt) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    if (/^(?:0|[1-9][0-9]*)$/.test(retryAfter)) {
      const value = requestedAt + Number(retryAfter) * 1_000;
      return Number.isSafeInteger(value) ? value : undefined;
    }
    const value = Date.parse(retryAfter);
    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  const rateReset = headers.get("x-ratelimit-reset");
  if (rateReset !== null && /^(?:0|[1-9][0-9]*)$/.test(rateReset)) {
    const value = Number(rateReset) * 1_000;
    return Number.isSafeInteger(value) ? value : undefined;
  }
  return undefined;
}

/** @param {string} apiBaseUrl @param {typeof fetch} fetchRequest @param {() => number} [now] */
export function createGitHubApiRequest(
  apiBaseUrl,
  fetchRequest,
  now = () => Date.now(),
) {
  /** @param {string} path @param {{affectedRepositoryIds?: number[], authorization?: string, body?: unknown, includePage?: boolean, method?: "GET" | "POST", repositoryId?: number}} [options] */
  return async function request(
    path,
    {
      affectedRepositoryIds,
      authorization,
      body,
      includePage = false,
      method = "GET",
      repositoryId,
    } = {},
  ) {
    let response;
    try {
      response = await fetchRequest(new URL(path, apiBaseUrl), {
        headers: {
          accept: "application/vnd.github+json",
          ...(authorization
            ? { authorization: `Bearer ${authorization}` }
            : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "x-github-api-version": API_VERSION,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        method,
        redirect: "error",
      });
    } catch (cause) {
      fail("github_api_unavailable", "GitHub API request could not complete", {
        affectedRepositoryIds,
        cause,
        repositoryId,
      });
    }
    if (!response.ok) {
      let rateLimitResponse = false;
      if (response.status === 403) {
        try {
          const body = /** @type {{message?: unknown}} */ (
            await response.clone().json()
          );
          rateLimitResponse =
            typeof body.message === "string" &&
            /(secondary rate limit|api rate limit exceeded)/i.test(
              body.message,
            );
        } catch {
          rateLimitResponse = false;
        }
      }
      if (
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 &&
          (response.headers.has("retry-after") ||
            response.headers.get("x-ratelimit-remaining") === "0" ||
            rateLimitResponse))
      ) {
        const nextAttemptAt = providerNextAttemptAt(response.headers, now());
        fail(
          "github_api_transient_failure",
          `GitHub API request temporarily failed with HTTP ${response.status}`,
          { affectedRepositoryIds, nextAttemptAt, repositoryId },
        );
      }
      if (Number.isSafeInteger(repositoryId) && response.status === 404) {
        fail(
          "github_repository_api_access_failed",
          "GitHub Repository API access verification failed",
          { affectedRepositoryIds, repositoryId },
        );
      }
      fail(
        "github_api_request_failed",
        `GitHub API request failed with HTTP ${response.status}`,
        { affectedRepositoryIds, repositoryId },
      );
    }
    try {
      const body = /** @type {unknown} */ (await response.json());
      return includePage ? { body, link: response.headers.get("link") } : body;
    } catch (cause) {
      fail("github_api_response_invalid", "GitHub API response is invalid", {
        affectedRepositoryIds,
        cause,
        repositoryId,
      });
    }
  };
}
