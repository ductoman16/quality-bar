/**
 * @param {{getEvaluations: () => any, getRepositories: () => any}} services
 */
export function createForgejoAutomaticApplicationDependencies({
  getEvaluations,
  getRepositories,
}) {
  return {
    acquirePullRequestChangeset(
      /** @type {{pullRequest: any, repositoryId: string}} */ {
        pullRequest,
        repositoryId,
      },
    ) {
      const repositories = getRepositories();
      if (!repositories) {
        throw new TypeError("Repository service is unavailable");
      }
      return repositories.resolveForgejoPullRequestChangeset(repositoryId, {
        baseSha: pullRequest.merge_base,
        headSha: pullRequest.head.sha,
      });
    },
    admitAutomaticEvaluation(
      /** @type {any} */ transaction,
      /** @type {any} */ input,
    ) {
      const evaluations = getEvaluations();
      if (!evaluations) {
        throw new TypeError("Evaluation service is unavailable");
      }
      return evaluations.admitAutomatic(transaction, input);
    },
  };
}
