import { requireCodedError } from "./coded-error.js";
import {
  browserMutationFailureStatus,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   failureCode: string,
 *   mutate: (body: unknown) => unknown,
 *   requestUrl: URL,
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
    mutate,
    requestUrl,
    statusFor,
    successStatus = 200,
    unexpectedMessage,
  },
) {
  try {
    requireBrowserMutationWithQuery(
      browserSessions,
      request,
      browserOrigin,
      requestUrl,
    );
    writeJson(
      response,
      successStatus,
      await mutate(await readJsonRequest(request)),
    );
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
    writeError(
      response,
      statusFor(failure.code, error),
      failure.code,
      failure.message,
    );
  }
}
