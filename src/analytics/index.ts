/**
 * Analytics is served through the evaluation service's `readAnalytics`
 * transition, so this composition-root entry point exists to give the
 * analytics domain a single register foothold without wiring a second
 * service instance. It returns nothing today; a future decomposition of the
 * analytics reader out of evaluation would install its service here.
 */
export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: Record<string, unknown>,
) {
  void fastify;
  void deps;
  return {};
}
