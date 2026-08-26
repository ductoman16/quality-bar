import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson } from "../http-response.ts";

export function createCodexExecutionConcurrencyOperations(dependencies: any) {
  if (
    typeof dependencies?.codexExecutionConcurrency?.read !== "function" ||
    typeof dependencies.codexExecutionConcurrency.set !== "function"
  ) {
    throw new TypeError("Codex execution concurrency service is unavailable");
  }
  const operations: Record<
    string,
    (
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) => unknown
  > = {
    getCodexExecutionConcurrency(request, response) {
      void request;
      try {
        writeJson(response, 200, {
          maximum_running: dependencies.codexExecutionConcurrency.read(),
        });
      } catch (caught) {
        const error = requireCodedError(caught);
        writeError(
          response,
          isUnavailableError(error) ? 503 : 422,
          error.code,
          error.message,
        );
      }
    },
    async updateCodexExecutionConcurrency(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "codex_execution_concurrency_change_failed",
        mutate: (body) => ({
          maximum_running: dependencies.codexExecutionConcurrency.set(
            (body as { maximum_running: number }).maximum_running,
          ),
        }),
        statusFor: (code, error) =>
          code === "storage_unavailable" || isUnavailableError(error)
            ? 503
            : 422,
        unexpectedMessage: "Codex execution concurrency change failed",
      });
    },
  };
  return operations;
}
