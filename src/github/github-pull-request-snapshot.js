import { GitHubConnectionError } from "./github-connection-error.js";

/** @param {unknown} value */
function validGitObjectId(value) {
  return (
    typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)
  );
}

/** @param {unknown} value */
function validPullRequest(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const pullRequest = /** @type {Record<string, any>} */ (value);
  return (
    Number.isSafeInteger(pullRequest.number) &&
    pullRequest.number > 0 &&
    ["closed", "open"].includes(pullRequest.state) &&
    typeof pullRequest.draft === "boolean" &&
    (pullRequest.merged_at === null ||
      (typeof pullRequest.merged_at === "string" &&
        Number.isSafeInteger(Date.parse(pullRequest.merged_at)))) &&
    validGitObjectId(pullRequest.base?.sha) &&
    validGitObjectId(pullRequest.head?.sha)
  );
}

/** @param {unknown} value */
export function pullRequestSnapshot(value) {
  if (
    !Array.isArray(value) ||
    value.some((pullRequest) => !validPullRequest(pullRequest)) ||
    new Set(value.map((pullRequest) => pullRequest.number)).size !==
      value.length
  ) {
    throw new GitHubConnectionError(
      "github_poll_response_invalid",
      "GitHub pull request snapshot is invalid",
    );
  }
  return value;
}
