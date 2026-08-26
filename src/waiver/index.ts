import { createWaiverAdjudicatorConfigurationService } from "./waiver-adjudicator-configuration.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create =
    deps.createWaiverAdjudicatorConfiguration ??
    createWaiverAdjudicatorConfigurationService;
  const waiverAdjudicatorConfiguration = create(deps.durableCore, {
    now: deps.now,
  });
  return { waiverAdjudicatorConfiguration };
}
