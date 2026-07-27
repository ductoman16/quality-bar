import { GitHubConnectionError } from "./github-connection-error.js";

const API_VERSION = "2026-03-10";

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
function fail(code, message, cause) {
  throw new GitHubConnectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** @param {string} apiBaseUrl @param {typeof fetch} fetchRequest */
export function createGitHubApiRequest(apiBaseUrl, fetchRequest) {
  /** @param {string} path @param {{authorization?: string, method?: "GET" | "POST", repositoryAccess?: boolean}} [options] */
  return async function request(
    path,
    { authorization, method = "GET", repositoryAccess = false } = {},
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
      fail(
        "github_api_unavailable",
        "GitHub API request could not complete",
        cause,
      );
    }
    if (!response.ok) {
      if (repositoryAccess && response.status === 404) {
        fail(
          "github_repository_api_access_failed",
          "GitHub Repository API access verification failed",
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
      fail(
        "github_api_response_invalid",
        "GitHub API response is invalid",
        cause,
      );
    }
  };
}
