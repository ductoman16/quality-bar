/** @param {any} verifier */
export function assertGitHubVerifier(verifier) {
  for (const capability of [
    "exchangeManifest",
    "listPullRequests",
    "publishAggregateFeedback",
    "publishCommitStatus",
    "publishInlineFeedback",
    "reconcileAggregateFeedback",
    "reconcileCommitStatus",
    "reconcileInlineFeedback",
    "verifyInstallation",
    "verifyRepositories",
  ]) {
    if (typeof verifier?.[capability] !== "function") {
      throw new TypeError("GitHub Connection dependencies are invalid");
    }
  }
}
