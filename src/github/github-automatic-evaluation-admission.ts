export async function acquireAutomaticEvaluations(
  previous: unknown,
  current: unknown,
  repositoryId: string,
  acquire: (input: { pullRequest: any; repositoryId: string }) => Promise<any>,
) {
  const evaluations = [];
  for (const pullRequest of newlyEligibleGitHubPullRequests(
    previous,
    current,
  )) {
    evaluations.push({
      changeset: await acquire({ pullRequest, repositoryId }),
      provider: "github",
      pullRequestNumber: pullRequest.number,
      repositoryId,
    });
  }
  return evaluations;
}
import { newlyEligibleGitHubPullRequests } from "./github-automatic-evaluation.ts";
