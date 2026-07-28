import { writeBrowserJsonMutation } from "./api-mutation.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";
import { forbidMachineOperatorAccess } from "./api-authorization.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   requestUrl: URL,
 *   waiverAdjudicatorConfiguration: ReturnType<typeof import("./waiver-adjudicator-configuration.js").createWaiverAdjudicatorConfigurationService>
 * }} dependencies
 */
export async function writeWaiverAdjudicatorConfiguration(
  request,
  response,
  {
    browserOrigin,
    browserSessions,
    requestUrl,
    waiverAdjudicatorConfiguration,
  },
) {
  if (request.method === "GET") {
    try {
      writeJson(response, 200, waiverAdjudicatorConfiguration.read());
    } catch (caught) {
      const error = requireCodedError(caught);
      writeError(
        response,
        isUnavailableError(caught) ? 503 : 422,
        error.code,
        error.message,
      );
    }
    return;
  }
  /** @param {string} code @param {unknown} error */
  function configurationChangeStatus(code, error) {
    return code === "storage_unavailable" || isUnavailableError(error)
      ? 503
      : 422;
  }
  await writeBrowserJsonMutation(request, response, {
    browserOrigin,
    browserSessions,
    failureCode: "waiver_adjudicator_configuration_change_failed",
    mutate: (body) => waiverAdjudicatorConfiguration.update(body),
    requestUrl,
    statusFor: configurationChangeStatus,
    unexpectedMessage: "Waiver Adjudicator Configuration change failed",
  });
}

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   recordAuthorityAttribution: (event: import("./api-authorization.js").AttributionEvent) => void,
 *   waiverAdjudicatorConfiguration: ReturnType<typeof import("./waiver-adjudicator-configuration.js").createWaiverAdjudicatorConfigurationService>
 * }} dependencies
 */
export function createWaiverAdjudicatorConfigurationRoute(dependencies) {
  return async function handleWaiverAdjudicatorConfiguration(
    /** @type {import("node:http").IncomingMessage} */ request,
    /** @type {import("node:http").ServerResponse} */ response,
    /** @type {URL} */ requestUrl,
    /** @type {"callback" | "machine" | "operator" | undefined} */ authority,
  ) {
    if (
      requestUrl.pathname !== "/api/v1/waiver-adjudicator-configuration" ||
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
    await writeWaiverAdjudicatorConfiguration(request, response, {
      ...dependencies,
      requestUrl,
    });
    return true;
  };
}
