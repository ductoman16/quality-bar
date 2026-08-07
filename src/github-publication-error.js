import { GitHubConnectionError } from "./github-connection-error.js";

/** @param {unknown} error */
export function githubPublicationFailure(error) {
  if (
    error instanceof GitHubConnectionError ||
    (error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.length > 0)
  ) {
    return {
      code: /** @type {string} */ (error.code),
      detail: error.message,
    };
  }
  throw error;
}
