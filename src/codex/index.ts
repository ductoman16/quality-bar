import { createCodexExecutionConcurrencyService } from "./codex-execution-concurrency.ts";

export function register(
  fastify: import("fastify").FastifyInstance | null,
  deps: any,
) {
  void fastify;
  const codexExecutionConcurrency = createCodexExecutionConcurrencyService(
    deps.durableCore,
  );
  return { codexExecutionConcurrency };
}
