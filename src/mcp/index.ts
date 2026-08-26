/**
 * The MCP domain currently exposes route handlers through
 * `createMcpRoute` inside the shared server assembly; there is no domain
 * service instance to construct in the composition root. This entry point
 * exists so every domain answers the same register contract, keeping the
 * root's registration list uniform. A future decomposition can move the
 * MCP route wiring onto its `fastify` argument.
 */
export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: Record<string, unknown>,
) {
  void fastify;
  void deps;
  return {};
}
