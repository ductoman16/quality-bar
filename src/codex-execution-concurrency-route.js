import { writeBrowserJsonMutation } from "./api-mutation.js";
import { forbidMachineOperatorAccess } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

const PATH = "/api/v1/system/codex-concurrency";

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
export function createCodexExecutionConcurrencyRoute(dependencies) {
  if (
    typeof dependencies?.codexExecutionConcurrency?.read !== "function" ||
    typeof dependencies.codexExecutionConcurrency.set !== "function"
  ) {
    throw new TypeError("Codex execution concurrency service is unavailable");
  }
  return async function handleCodexExecutionConcurrency(
    /** @type {import("node:http").IncomingMessage} */ request,
    /** @type {import("node:http").ServerResponse} */ response,
    /** @type {URL} */ requestUrl,
    /** @type {"callback" | "machine" | "operator" | undefined} */ authority,
  ) {
    if (
      requestUrl.pathname !== PATH ||
      !["GET", "PATCH"].includes(request.method ?? "")
    ) {
      return false;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
    } catch (caught) {
      const error = requireCodedError(caught);
      writeError(response, 400, error.code, error.message);
      return true;
    }
    if (authority === "machine") {
      forbidMachineOperatorAccess(
        response,
        dependencies.recordAuthorityAttribution,
      );
      return true;
    }
    if (request.method === "GET") {
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
      return true;
    }
    await writeBrowserJsonMutation(request, response, {
      browserOrigin: dependencies.browserOrigin,
      browserSessions: dependencies.browserSessions,
      failureCode: "codex_execution_concurrency_change_failed",
      mutate: (body) => ({
        maximum_running: dependencies.codexExecutionConcurrency.set(
          readMaximumRunning(body),
        ),
      }),
      requestUrl,
      statusFor: (code, error) =>
        code === "storage_unavailable" || isUnavailableError(error) ? 503 : 422,
      unexpectedMessage: "Codex execution concurrency change failed",
    });
    return true;
  };
}
