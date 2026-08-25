import { createEvaluationService } from "./evaluation.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const create = deps.createEvaluations ?? createEvaluationService;
  const evaluations = create(deps.durableCore, {
    acquireChangeset: (
      /** @type {string} */ repositoryId,
      /** @type {any} */ request,
    ) => deps.ioPool.acquireChangeset(deps.repositories, repositoryId, request),
    readCodexCapabilityFailure: deps.readCodexCapabilityFailure,
    masterKey: deps.masterKey,
    now: deps.now,
    storageReserve: deps.storageReserve,
    validateCodexAuthentication: deps.validateCodexAuthentication,
  });
  return { evaluations };
}
