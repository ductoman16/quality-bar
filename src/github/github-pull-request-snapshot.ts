import { GitHubConnectionError } from "./github-connection-error.ts";

function validGitObjectId(value: unknown) {
  return (
    typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)
  );
}

function validPullRequest(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const pullRequest = value as Record<string, any>;
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

export function pullRequestSnapshot(value: unknown) {
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
