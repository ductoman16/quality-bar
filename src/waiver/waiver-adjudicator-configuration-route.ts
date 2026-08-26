import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson } from "../http-response.ts";

export function createWaiverAdjudicatorConfigurationOperations(dependencies: {
  waiverAdjudicatorConfiguration: any;
}) {
  return {
    getWaiverAdjudicatorConfiguration(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
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
    async updateWaiverAdjudicatorConfiguration(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      await writeBrowserJsonMutation(request, response, {
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
