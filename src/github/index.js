import { createGitHubConnectionService } from "./github-connection.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const create = deps.createGitHubConnections ?? createGitHubConnectionService;
  const githubConnections = create(deps.durableCore, {
    acquirePullRequestChangeset: (
      /** @type {{pullRequest: any, repositoryId: string}} */ {
        pullRequest,
        repositoryId,
      },
    ) => {
      const repositories = deps.getRepositories();
      if (!repositories) {
        throw new TypeError("Repository service is unavailable");
      }
      return repositories.resolvePullRequestChangeset(repositoryId, {
        baseSha: pullRequest.base.sha,
        headSha: pullRequest.head.sha,
      });
    },
    admitAutomaticEvaluation: (
      /** @type {any} */ transaction,
      /** @type {any} */ input,
    ) => {
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
