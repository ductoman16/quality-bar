export function assertGitHubVerifier(verifier: any) {
  for (const capability of [
    "exchangeManifest",
    "listPullRequests",
    "publishAggregateFeedback",
    "publishCommitStatus",
    "publishInlineFeedback",
    "publishReviewCommentReply",
    "reconcileAggregateFeedback",
    "reconcileCommitStatus",
    "reconcileInlineFeedback",
    "reconcileReviewCommentReply",
    "verifyInstallation",
    "verifyRepositories",
  ]) {
    if (typeof verifier?.[capability] !== "function") {
      throw new TypeError("GitHub Connection dependencies are invalid");
    }
  }
}
