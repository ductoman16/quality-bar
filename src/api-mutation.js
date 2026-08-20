import { requireCodedError } from "./coded-error.js";
import {
  browserMutationFailureStatus,
  requireBrowserMutation,
} from "./http-request.js";
import { createErrorDocument, writeError, writeJson } from "./http-response.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   failureCode: string,
 *   failureDetails?: (code: string, error: unknown) => Record<string, unknown> | undefined,
 *   mutate: (body: unknown) => unknown,
 *   statusFor: (code: string, error: unknown) => number,
 *   successStatus?: number,
 *   unexpectedMessage?: string
 * }} options
 */
export async function writeBrowserJsonMutation(
  request,
  response,
  {
    browserOrigin,
    browserSessions,
    failureCode,
    failureDetails,
    mutate,
    statusFor,
    successStatus = 200,
    unexpectedMessage,
  },
) {
  try {
    requireBrowserMutation(browserSessions, request, browserOrigin);
    writeJson(response, successStatus, await mutate(request.body));
  } catch (error) {
    if (
      error instanceof Error &&
      (!("code" in error) || typeof error.code !== "string")
    ) {
      writeError(
        response,
        500,
        failureCode,
        unexpectedMessage ?? error.message,
      );
      return;
    }
    const failure = requireCodedError(error);
    if (failure.message === "request_malformed") {
      writeError(response, 400, "request_malformed", "Request is malformed");
      return;
    }
    if (
      ["csrf_invalid", "origin_invalid", "authentication_required"].includes(
        failure.code,
      )
    ) {
      writeError(
        response,
        browserMutationFailureStatus(failure.code),
        failure.code,
        failure.message,
      );
      return;
    }
    const status = statusFor(failure.code, error);
    const details = failureDetails?.(failure.code, error);
    if (details) {
      writeJson(response, status, {
        ...createErrorDocument(failure.code, failure.message),
        ...details,
      });
      return;
    }
    writeError(response, status, failure.code, failure.message);
  }
}
