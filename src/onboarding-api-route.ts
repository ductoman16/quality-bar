import { requireCodedError } from "./coded-error.ts";
import { bearerToken, isUnavailableError } from "./http-request.ts";
import { writeError, writeJson, writeStatus } from "./http-response.ts";

function pathParameter(
  request: import("fastify").FastifyRequest,
  name: string,
) {
  return (request.params as Record<string, string>)[name];
}

export function createOnboardingApiOperations({
  onboardingTokens,
  operations,
}: {
  onboardingTokens: any;
  operations: any;
}) {
  const grant = (request: import("fastify").FastifyRequest) =>
    (request as any).onboardingGrant;

  const handle: (
    operation: (
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) => unknown,
  ) => (
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
  ) => Promise<void> = (operation) => async (request, response) => {
    try {
      await operation(request, response);
    } catch (error) {
      const failure = requireCodedError(error);
      const status = /_not_found$/.test(failure.code)
        ? 404
        : /_conflict$|_already_active$/.test(failure.code)
          ? 409
          : isUnavailableError(error)
            ? 503
            : 422;
      writeError(response, status, failure.code, failure.message);
    }
  };

  return {
    listOnboardingTokens: handle((request, response) => {
      void request;
      writeJson(response, 200, { onboarding_tokens: onboardingTokens.list() });
    }),
    createOnboardingToken: handle((request, response) => {
      writeJson(response, 201, onboardingTokens.create(request.body));
    }),
    revokeOnboardingToken: handle((request, response) => {
      onboardingTokens.revoke(pathParameter(request, "onboarding_token_id"));
      writeStatus(response, 204);
    }),
    revokeCurrentOnboardingToken: handle((request, response) => {
      operations.revoke(grant(request), bearerToken(request));
      writeStatus(response, 204);
    }),
    registerOnboardingRepository: handle(async (request, response) =>
      writeJson(
        response,
        201,
        await operations.registerRepository(grant(request), request.body),
      ),
    ),
    setOnboardingRepositoryReviews: handle((request, response) =>
      writeJson(
        response,
        200,
        operations.setReviews(
          grant(request),
          pathParameter(request, "repository_id"),
          request.body,
        ),
      ),
    ),
    createOnboardingRepositoryReview: handle((request, response) =>
      writeJson(
        response,
        201,
        operations.createReview(
          grant(request),
          pathParameter(request, "repository_id"),
          request.body,
        ),
      ),
    ),
    updateOnboardingReviewMetadata: handle((request, response) =>
      writeJson(
        response,
        200,
        operations.updateReviewMetadata(
          grant(request),
          pathParameter(request, "review_id"),
          request.body,
        ),
      ),
    ),
    saveOnboardingReviewVersion: handle((request, response) =>
      writeJson(
        response,
        201,
        operations.saveReviewVersion(
          grant(request),
          pathParameter(request, "review_id"),
          request.body,
        ),
      ),
    ),
    listGenericRepositories: handle((request, response) => {
      writeJson(response, 200, operations.listRepositories(grant(request)));
    }),
    listReviews: handle((request, response) => {
      void request;
      writeJson(response, 200, operations.listReviews());
    }),
    getRepositoryGuidance: handle((request, response) =>
      writeJson(
        response,
        200,
        operations.guidance(
          grant(request),
          pathParameter(request, "repository_id"),
        ),
      ),
    ),
    getEvaluation: handle((request, response) =>
      writeJson(
        response,
        200,
        operations.readEvaluation(
          grant(request),
          pathParameter(request, "evaluation_id"),
        ),
      ),
    ),
    getEvaluationResult: handle((request, response) =>
      writeJson(
        response,
        200,
        operations.readEvaluationResult(
          grant(request),
          pathParameter(request, "evaluation_id"),
        ),
      ),
    ),
    createExplicitEvaluation: handle(async (request, response) => {
      const created = await operations.createEvaluation(
        grant(request),
        pathParameter(request, "repository_id"),
        request.body,
        request.headers["idempotency-key"],
        "implementer_token",
      );
      writeJson(response, created.status, created.resource, {
        location: `/api/v1/evaluations/${encodeURIComponent(created.resource.id)}`,
      });
    }),
  };
}
