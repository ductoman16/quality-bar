import { createSystemResource } from "./system-resource.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const create = deps.createSystemResource ?? createSystemResource;
  const systemResource = create(deps.durableCore, {
    applicationVersion: deps.applicationVersion,
    backupsPath: deps.backupsPath,
    installationKeyIdentity: deps.installationKeyIdentity,
    now: deps.now,
  });
  return { systemResource };
}
