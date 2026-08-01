/**
 * @param {unknown} previous
 * @param {unknown} current
 * @param {string} repositoryId
 * @param {(input: {pullRequest: any, repositoryId: string}) => Promise<any>} acquire
 */
export async function acquireAutomaticEvaluations(
  previous,
  current,
  repositoryId,
  acquire,
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
import { newlyEligibleGitHubPullRequests } from "./github-automatic-evaluation.js";
