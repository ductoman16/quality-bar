import { writeBrowserJsonMutation } from "./api-mutation.js";
import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/** @param {{browserOrigin: string, browserSessions: any, waiverAdjudicatorConfiguration: any}} dependencies */
export function createWaiverAdjudicatorConfigurationOperations(dependencies) {
  return {
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    getWaiverAdjudicatorConfiguration(request, response) {
      void request;
      try {
        writeJson(
          response,
          200,
          dependencies.waiverAdjudicatorConfiguration.read(),
        );
      } catch (caught) {
        const error = requireCodedError(caught);
        writeError(
          response,
          isUnavailableError(caught) ? 503 : 422,
          error.code,
          error.message,
        );
      }
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    async updateWaiverAdjudicatorConfiguration(request, response) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin: dependencies.browserOrigin,
        browserSessions: dependencies.browserSessions,
        failureCode: "waiver_adjudicator_configuration_change_failed",
        mutate: (body) =>
          dependencies.waiverAdjudicatorConfiguration.update(body),
        statusFor: (code, error) =>
          code === "storage_unavailable" || isUnavailableError(error)
            ? 503
            : 422,
        unexpectedMessage: "Waiver Adjudicator Configuration change failed",
      });
    },
  };
}
