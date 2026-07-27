import { GitHubConnectionError } from "./github-connection-error.js";

const INVALID_SELECTION_MESSAGE =
  "GitHub Repository selection must contain unique stable Repository IDs";

/** @param {unknown} request */
export function normalizeGitHubRepositorySelection(request) {
  if (
    !request ||
    Array.isArray(request) ||
    typeof request !== "object" ||
    ![1, 2].includes(Object.keys(request).length) ||
    !("repository_ids" in request) ||
    !Array.isArray(request.repository_ids) ||
    request.repository_ids.length === 0 ||
    request.repository_ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(request.repository_ids).size !== request.repository_ids.length ||
    ("request_id" in request &&
      (typeof request.request_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          request.request_id,
        ))) ||
    Object.keys(request).some(
      (key) => !["repository_ids", "request_id"].includes(key),
    )
  ) {
    throw new GitHubConnectionError(
      "github_repository_selection_invalid",
      INVALID_SELECTION_MESSAGE,
    );
  }
  return {
    repositoryIds: /** @type {number[]} */ (request.repository_ids),
    requestId:
      "request_id" in request
        ? /** @type {string} */ (request.request_id)
        : undefined,
  };
}
