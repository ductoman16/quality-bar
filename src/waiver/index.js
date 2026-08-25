import { createWaiverAdjudicatorConfigurationService } from "./waiver-adjudicator-configuration.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const create =
    deps.createWaiverAdjudicatorConfiguration ??
    createWaiverAdjudicatorConfigurationService;
  const waiverAdjudicatorConfiguration = create(deps.durableCore, {
    now: deps.now,
  });
  return { waiverAdjudicatorConfiguration };
}
