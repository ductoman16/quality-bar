import { createEvaluationService } from "./evaluation.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create = deps.createEvaluations ?? createEvaluationService;
  const evaluations = create(deps.durableCore, {
    acquireChangeset: (repositoryId: string, request: any) =>
      deps.ioPool.acquireChangeset(deps.repositories, repositoryId, request),
    readCodexCapabilityFailure: deps.readCodexCapabilityFailure,
    masterKey: deps.masterKey,
    now: deps.now,
    storageReserve: deps.storageReserve,
    validateCodexAuthentication: deps.validateCodexAuthentication,
  });
  return { evaluations };
}
