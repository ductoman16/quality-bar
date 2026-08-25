import { createSystemResource } from "./system-resource.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
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
