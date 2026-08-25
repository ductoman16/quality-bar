import { createRepositoryService } from "./repository.js";
import { createRepositoryGuidanceService } from "./repository-guidance.js";
import { createRepositoryProviderApplicationDependencies } from "./repository-provider-application-dependencies.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const create = deps.createRepositories ?? createRepositoryService;
  const repositories = create(deps.durableCore, {
    ...createRepositoryProviderApplicationDependencies({
      getForgejoConnections: deps.getForgejoConnections,
      getGitHubConnections: deps.getGitHubConnections,
    }),
    certificateAuthorityPath: deps.certificateAuthorityPath,
    masterKey: deps.masterKey,
    now: deps.now,
    registerSecret: deps.registerSecret,
  });
  const createGuidance =
    deps.createRepositoryGuidance ?? createRepositoryGuidanceService;
  const repositoryGuidance = createGuidance(deps.durableCore);
  return { repositories, repositoryGuidance };
}
