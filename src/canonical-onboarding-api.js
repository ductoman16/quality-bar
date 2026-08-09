const onboarding = [{ onboarding_token: [] }];
const browser = [{ browser_session: [] }];

/** @param {string} schema */
const request = (schema) => ({
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
  required: true,
});

/** @param {string} schema @param {string} description */
const response = (schema, description) => ({
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
  description,
});

const repositoryId = {
  in: "path",
  name: "repository_id",
  required: true,
  schema: { minLength: 1, type: "string" },
};

const reviewId = {
  in: "path",
  name: "review_id",
  required: true,
  schema: { minLength: 1, type: "string" },
};

/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalOnboardingPaths(mutationParameters, errorResponse) {
  const failures = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
    503: errorResponse,
  };
  return {
    "/api/v1/onboarding-tokens": {
      get: {
        operationId: "listOnboardingTokens",
        responses: {
          200: response(
            "OnboardingTokenCollection",
            "Active onboarding tokens",
          ),
          ...failures,
        },
        security: browser,
      },
      post: {
        operationId: "createOnboardingToken",
        parameters: mutationParameters,
        requestBody: request("OnboardingTokenCreateRequest"),
        responses: {
          201: response(
            "OnboardingTokenReveal",
            "One-time onboarding token reveal",
          ),
          ...failures,
        },
        security: browser,
      },
    },
    "/api/v1/onboarding-tokens/{onboarding_token_id}": {
      delete: {
        operationId: "revokeOnboardingToken",
        parameters: [
          {
            in: "path",
            name: "onboarding_token_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          ...mutationParameters,
        ],
        requestBody: request("EmptyRequest"),
        responses: {
          204: { description: "Onboarding token revoked" },
          ...failures,
        },
        security: browser,
      },
    },
    "/api/v1/onboarding-token/revoke": {
      post: {
        operationId: "revokeCurrentOnboardingToken",
        requestBody: request("EmptyRequest"),
        responses: {
          204: { description: "Current onboarding token revoked" },
          ...failures,
        },
        security: onboarding,
      },
    },
    "/api/v1/onboarding/repository": {
      post: {
        operationId: "registerOnboardingRepository",
        requestBody: request("OnboardingRepositoryRegistrationRequest"),
        responses: {
          201: response("Repository", "Verified public HTTPS Repository"),
          ...failures,
        },
        security: onboarding,
      },
    },
    "/api/v1/repositories/{repository_id}/review-selection": {
      put: {
        operationId: "setOnboardingRepositoryReviews",
        parameters: [repositoryId],
        requestBody: request("OnboardingReviewSelectionRequest"),
        responses: {
          200: response(
            "OnboardingReviewSelectionResult",
            "Atomic Review selection change",
          ),
          ...failures,
        },
        security: onboarding,
      },
    },
    "/api/v1/repositories/{repository_id}/reviews": {
      post: {
        operationId: "createOnboardingRepositoryReview",
        parameters: [repositoryId],
        requestBody: request("OnboardingReviewCreateRequest"),
        responses: {
          201: response("Review", "Repository-specific Review"),
          ...failures,
        },
        security: onboarding,
      },
    },
    "/api/v1/onboarding/reviews/{review_id}/metadata": {
      patch: {
        operationId: "updateOnboardingReviewMetadata",
        parameters: [reviewId],
        requestBody: request("ReviewMetadataUpdateRequest"),
        responses: {
          200: response("Review", "Updated Repository-specific Review"),
          ...failures,
        },
        security: onboarding,
      },
    },
    "/api/v1/onboarding/reviews/{review_id}/versions": {
      post: {
        operationId: "saveOnboardingReviewVersion",
        parameters: [reviewId],
        requestBody: request("ReviewVersionSaveRequest"),
        responses: {
          201: response(
            "ReviewVersionSaveResult",
            "Saved Repository-specific Review Version",
          ),
          ...failures,
        },
        security: onboarding,
      },
    },
  };
}
