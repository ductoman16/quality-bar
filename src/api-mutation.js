import { requireCodedError } from "./coded-error.js";
import { createErrorDocument, writeError, writeJson } from "./http-response.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 * @param {{
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
    failureCode,
    failureDetails,
    mutate,
    statusFor,
    successStatus = 200,
    unexpectedMessage,
  },
) {
  try {
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
