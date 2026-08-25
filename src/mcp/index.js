/**
 * The MCP domain currently exposes route handlers through
 * `createMcpRoute` inside the shared server assembly; there is no domain
 * service instance to construct in the composition root. This entry point
 * exists so every domain answers the same register contract, keeping the
 * root's registration list uniform. A future decomposition can move the
 * MCP route wiring onto its `fastify` argument.
 *
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {Record<string, unknown>} deps
 */
export function register(fastify, deps) {
  void fastify;
  void deps;
  return {};
}
