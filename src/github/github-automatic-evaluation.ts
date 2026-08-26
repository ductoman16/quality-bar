import { pullRequestSnapshot } from "./github-pull-request-snapshot.ts";

export function newlyEligibleGitHubPullRequests(
  previousSnapshot: unknown,
  currentSnapshot: unknown,
) {
  const previous = pullRequestSnapshot(previousSnapshot);
  const current = pullRequestSnapshot(currentSnapshot);
  const previousByNumber = new Map(
    previous.map((pullRequest) => [pullRequest.number, pullRequest]),
  );
  return current.filter((pullRequest) => {
    if (
      pullRequest.state !== "open" ||
      pullRequest.draft ||
      pullRequest.merged_at !== null
    ) {
      return false;
    }
    const observed = previousByNumber.get(pullRequest.number);
    return (
      observed === undefined ||
      observed.state !== "open" ||
      observed.draft ||
      observed.merged_at !== null ||
      observed.base.sha !== pullRequest.base.sha ||
      observed.head.sha !== pullRequest.head.sha
    );
  });
}
