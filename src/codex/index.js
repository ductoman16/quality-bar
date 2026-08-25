import { createCodexExecutionConcurrencyService } from "./codex-execution-concurrency.js";

/**
 * @param {import("fastify").FastifyInstance | null} fastify
 * @param {any} deps
 */
export function register(fastify, deps) {
  void fastify;
  const codexExecutionConcurrency = createCodexExecutionConcurrencyService(
    deps.durableCore,
  );
  return { codexExecutionConcurrency };
}
