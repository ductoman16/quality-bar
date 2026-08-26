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
  const baseSha = pullRequest.base?.sha;
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
    validGitObjectId(pullRequest.head?.sha) &&
    pullRequest.merge_base.length === pullRequest.head.sha.length &&
    ((validGitObjectId(baseSha) &&
      pullRequest.merge_base.length === baseSha.length) ||
      (pullRequest.state === "closed" && baseSha === ""))
  );
}

export function forgejoPullRequestSnapshot(value: unknown) {
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

export function newlyEligibleForgejoPullRequests(
  previousSnapshot: unknown,
  currentSnapshot: unknown,
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
