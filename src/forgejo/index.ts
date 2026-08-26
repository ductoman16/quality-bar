import { createForgejoConnectionService } from "./forgejo-connection.ts";
import { createForgejoAutomaticApplicationDependencies } from "./forgejo-automatic-application-dependencies.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create =
    deps.createForgejoConnections ?? createForgejoConnectionService;
  const forgejoConnections = create(deps.durableCore, {
    ...createForgejoAutomaticApplicationDependencies({
      getEvaluations: deps.getEvaluations,
      getRepositories: deps.getRepositories,
    }),
    externalOrigin: deps.externalOrigin,
    certificateAuthorityPath: deps.certificateAuthorityPath,
    masterKey: deps.masterKey,
    now: deps.now,
    registerSecret: deps.registerSecret,
    storageReserve: deps.storageReserve,
  });
  return { forgejoConnections };
}
