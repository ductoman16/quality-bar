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
    typeof pullRequest.merged === "boolean" &&
    validGitObjectId(pullRequest.merge_base) &&
    (pullRequest.merged_at === null ||
      (typeof pullRequest.merged_at === "string" &&
        Number.isSafeInteger(Date.parse(pullRequest.merged_at)))) &&
    validGitObjectId(pullRequest.base?.sha) &&
    validGitObjectId(pullRequest.head?.sha) &&
    pullRequest.merge_base.length === pullRequest.base.sha.length &&
    pullRequest.merge_base.length === pullRequest.head.sha.length
  );
}

/** @param {unknown} value */
export function forgejoPullRequestSnapshot(value) {
  if (
    !Array.isArray(value) ||
    value.some((pullRequest) => !validPullRequest(pullRequest)) ||
    new Set(value.map((pullRequest) => pullRequest.number)).size !==
      value.length
  ) {
    throw Object.assign(new Error("Forgejo pull request snapshot is invalid"), {
      code: "forgejo_poll_response_invalid",
    });
  }
  return value;
}

/**
 * @param {unknown} previousSnapshot
 * @param {unknown} currentSnapshot
 */
export function newlyEligibleForgejoPullRequests(
  previousSnapshot,
  currentSnapshot,
) {
  const previous = forgejoPullRequestSnapshot(previousSnapshot);
  const current = forgejoPullRequestSnapshot(currentSnapshot);
  const previousByNumber = new Map(
    previous.map((pullRequest) => [pullRequest.number, pullRequest]),
  );
  return current.filter((pullRequest) => {
    if (
      pullRequest.state !== "open" ||
      pullRequest.draft ||
      pullRequest.merged ||
      pullRequest.merged_at !== null
    ) {
      return false;
    }
    const observed = previousByNumber.get(pullRequest.number);
    return (
      observed === undefined ||
      observed.state !== "open" ||
      observed.draft ||
      observed.merge_base !== pullRequest.merge_base ||
      observed.head.sha !== pullRequest.head.sha
    );
  });
}
