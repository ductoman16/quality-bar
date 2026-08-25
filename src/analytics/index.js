/**
 * Analytics is served through the evaluation service's `readAnalytics`
 * transition, so this composition-root entry point exists to give the
 * analytics domain a single register foothold without wiring a second
 * service instance. It returns nothing today; a future decomposition of the
 * analytics reader out of evaluation would install its service here.
 *
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {Record<string, unknown>} deps
 */
export function register(fastify, deps) {
  void fastify;
  void deps;
  return {};
}
