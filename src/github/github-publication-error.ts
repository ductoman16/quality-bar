import { GitHubConnectionError } from "./github-connection-error.ts";

export function githubPublicationFailure(error: unknown) {
  if (
    error instanceof GitHubConnectionError ||
    (error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.length > 0)
  ) {
    return {
      code: error.code as string,
      detail: error.message,
    };
  }
  throw error;
}
