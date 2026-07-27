import { GitHubConnectionError } from "./github-connection-error.js";

const INVALID_SELECTION_MESSAGE =
  "GitHub Repository selection must contain unique stable Repository IDs";

/** @param {unknown} request */
export function normalizeGitHubRepositorySelection(request) {
  if (
    !request ||
    Array.isArray(request) ||
    typeof request !== "object" ||
    Object.keys(request).length !== 1 ||
    !("repository_ids" in request) ||
    !Array.isArray(request.repository_ids) ||
    request.repository_ids.length === 0 ||
    request.repository_ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(request.repository_ids).size !== request.repository_ids.length
  ) {
    throw new GitHubConnectionError(
      "github_repository_selection_invalid",
      INVALID_SELECTION_MESSAGE,
    );
  }
  return /** @type {number[]} */ (request.repository_ids);
}
