import { createRepositoryService } from "./repository.ts";
import { createRepositoryGuidanceService } from "./repository-guidance.ts";
import { createRepositoryProviderApplicationDependencies } from "./repository-provider-application-dependencies.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
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
