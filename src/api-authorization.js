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
export function forbidMachineSystemAccess(
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
