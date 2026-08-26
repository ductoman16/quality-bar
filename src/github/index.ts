import { createGitHubConnectionService } from "./github-connection.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create = deps.createGitHubConnections ?? createGitHubConnectionService;
  const githubConnections = create(deps.durableCore, {
    acquirePullRequestChangeset: ({
      pullRequest,
      repositoryId,
    }: {
      pullRequest: any;
      repositoryId: string;
    }) => {
      const repositories = deps.getRepositories();
      if (!repositories) {
        throw new TypeError("Repository service is unavailable");
      }
      return repositories.resolvePullRequestChangeset(repositoryId, {
        baseSha: pullRequest.base.sha,
        headSha: pullRequest.head.sha,
      });
    },
    admitAutomaticEvaluation: (transaction: any, input: any) => {
      const evaluations = deps.getEvaluations();
      if (!evaluations) {
        throw new TypeError("Evaluation service is unavailable");
      }
      return evaluations.admitAutomatic(transaction, input);
    },
    externalOrigin: deps.externalOrigin,
    masterKey: deps.masterKey,
    now: deps.now,
    registerSecret: deps.registerSecret,
    storageReserve: deps.storageReserve,
  });
  return { githubConnections };
}
