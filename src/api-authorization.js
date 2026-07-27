import { requireCodedError } from "./coded-error.js";
import {
  authenticationFailureStatus,
  requireImplementerTokenAuthority,
} from "./http-request.js";
import { writeError } from "./http-response.js";

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   errorCode?: string,
 *   outcome: string
 * }} AttributionEvent
 */

/**
 * @param {import("node:http").ServerResponse} response
 * @param {(event: AttributionEvent) => void} recordAuthorityAttribution
 */
export function forbidMachineOperatorAccess(
  response,
  recordAuthorityAttribution,
) {
  recordAuthorityAttribution({
    action: "authorization",
    channel: "implementer_token",
    errorCode: "authorization_forbidden",
    outcome: "forbidden",
  });
  writeError(
    response,
    403,
    "authorization_forbidden",
    "Machine access is forbidden",
  );
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof import("./implementer-token.js").createImplementerTokenService>} implementerTokens
 * @param {(event: AttributionEvent) => void} recordAuthorityAttribution
 */
export function writeMachineOperatorAccessDenial(
  request,
  response,
  implementerTokens,
  recordAuthorityAttribution,
) {
  try {
    requireImplementerTokenAuthority(implementerTokens, request);
    recordAuthorityAttribution({
      action: "authentication",
      channel: "implementer_token",
      outcome: "success",
    });
    forbidMachineOperatorAccess(response, recordAuthorityAttribution);
  } catch (error) {
    const failure = requireCodedError(error);
    recordAuthorityAttribution({
      action: "authentication",
      channel: "implementer_token",
      errorCode: failure.code,
      outcome: "failure",
    });
    writeError(
      response,
      authenticationFailureStatus(failure.code),
      failure.code,
      failure.message,
    );
  }
}
