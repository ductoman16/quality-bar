export function createForgejoAutomaticApplicationDependencies({
  getEvaluations,
  getRepositories,
}: {
  getEvaluations: () => any;
  getRepositories: () => any;
}) {
  return {
    acquirePullRequestChangeset({
      pullRequest,
      repositoryId,
    }: {
      pullRequest: any;
      repositoryId: string;
    }) {
      const repositories = getRepositories();
      if (!repositories) {
        throw new TypeError("Repository service is unavailable");
      }
      return repositories.resolveForgejoPullRequestChangeset(repositoryId, {
        baseSha: pullRequest.merge_base,
        headSha: pullRequest.head.sha,
      });
    },
    admitAutomaticEvaluation(transaction: any, input: any) {
      const evaluations = getEvaluations();
      if (!evaluations) {
        throw new TypeError("Evaluation service is unavailable");
      }
      return evaluations.admitAutomatic(transaction, input);
    },
  };
}
