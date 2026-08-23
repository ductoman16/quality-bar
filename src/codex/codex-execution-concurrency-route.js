import { writeBrowserJsonMutation } from "../api-mutation.js";
import { requireCodedError } from "../coded-error.js";
import { isUnavailableError } from "../http-request.js";
import { writeError, writeJson } from "../http-response.js";

/** @param {any} dependencies */
export function createCodexExecutionConcurrencyOperations(dependencies) {
  if (
    typeof dependencies?.codexExecutionConcurrency?.read !== "function" ||
    typeof dependencies.codexExecutionConcurrency.set !== "function"
  ) {
    throw new TypeError("Codex execution concurrency service is unavailable");
  }
  /** @type {Record<string, (request: import("fastify").FastifyRequest, response: import("fastify").FastifyReply) => unknown>} */
  const operations = {
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
            /** @type {{maximum_running: number}} */ (body).maximum_running,
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
