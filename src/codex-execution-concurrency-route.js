import { writeBrowserJsonMutation } from "./api-mutation.js";
import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/** @param {unknown} body */
function readMaximumRunning(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "maximum_running"
  ) {
    return body;
  }
  return /** @type {any} */ (body).maximum_running;
}

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
        browserOrigin: dependencies.browserOrigin,
        browserSessions: dependencies.browserSessions,
        failureCode: "codex_execution_concurrency_change_failed",
        mutate: (body) => ({
          maximum_running: dependencies.codexExecutionConcurrency.set(
            readMaximumRunning(body),
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
