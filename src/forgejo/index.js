import { createForgejoConnectionService } from "./forgejo-connection.js";
import { createForgejoAutomaticApplicationDependencies } from "./forgejo-automatic-application-dependencies.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
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
