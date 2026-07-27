import { GitHubConnectionError } from "./github-connection-error.js";

const API_VERSION = "2026-03-10";

/** @param {string} code @param {string} message @param {{affectedRepositoryIds?: number[], cause?: unknown, repositoryId?: number}} [options] @returns {never} */
function fail(code, message, options) {
  throw new GitHubConnectionError(code, message, options);
}

/** @param {string} apiBaseUrl @param {typeof fetch} fetchRequest */
export function createGitHubApiRequest(apiBaseUrl, fetchRequest) {
  /** @param {string} path @param {{affectedRepositoryIds?: number[], authorization?: string, method?: "GET" | "POST", repositoryId?: number}} [options] */
  return async function request(
    path,
    { affectedRepositoryIds, authorization, method = "GET", repositoryId } = {},
  ) {
    let response;
    try {
      response = await fetchRequest(new URL(path, apiBaseUrl), {
        headers: {
          accept: "application/vnd.github+json",
          ...(authorization
            ? { authorization: `Bearer ${authorization}` }
            : {}),
          "x-github-api-version": API_VERSION,
        },
        method,
        redirect: "error",
      });
    } catch (cause) {
      fail("github_api_unavailable", "GitHub API request could not complete", {
        cause,
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
        fail(
          "github_api_transient_failure",
          `GitHub API request temporarily failed with HTTP ${response.status}`,
          { affectedRepositoryIds, repositoryId },
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
      );
    }
    try {
      return /** @type {unknown} */ (await response.json());
    } catch (cause) {
      fail("github_api_response_invalid", "GitHub API response is invalid", {
        cause,
      });
    }
  };
}
