import { errorResponses } from "../http-route-schema.js";

export const onboardingSchemas = {};

export const onboardingRoutes = [
  {
    method: "GET",
    schema: {
      operationId: "listOnboardingTokens",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "OnboardingTokenCollection#",
          description: "Active onboarding tokens",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
    },
    url: "/api/v1/onboarding-tokens",
  },
  {
    method: "POST",
    schema: {
      operationId: "createOnboardingToken",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          $ref: "OnboardingTokenReveal#",
          description: "One-time onboarding token reveal",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "OnboardingTokenCreateRequest#",
      },
    },
    url: "/api/v1/onboarding-tokens",
  },
  {
    method: "DELETE",
    schema: {
      operationId: "revokeOnboardingToken",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Onboarding token revoked",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "EmptyRequest#",
      },
    },
    url: "/api/v1/onboarding-tokens/:onboarding_token_id",
  },
  {
    method: "POST",
    schema: {
      operationId: "revokeCurrentOnboardingToken",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Current onboarding token revoked",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "EmptyRequest#",
      },
    },
    url: "/api/v1/onboarding-token/revoke",
  },
  {
    method: "POST",
    schema: {
      operationId: "registerOnboardingRepository",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        201: {
          $ref: "Repository#",
          description: "Verified public HTTPS Repository",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "OnboardingRepositoryRegistrationRequest#",
      },
    },
    url: "/api/v1/onboarding/repository",
  },
  {
    method: "PUT",
    schema: {
      operationId: "setOnboardingRepositoryReviews",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "OnboardingReviewSelectionResult#",
          description: "Atomic Review selection change",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "OnboardingReviewSelectionRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id/review-selection",
  },
  {
    method: "POST",
    schema: {
      operationId: "createOnboardingRepositoryReview",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        201: {
          $ref: "Review#",
          description: "Repository-specific Review",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "OnboardingReviewCreateRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id/reviews",
  },
  {
    method: "PATCH",
    schema: {
      operationId: "updateOnboardingReviewMetadata",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "Review#",
          description: "Updated Repository-specific Review",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "ReviewMetadataUpdateRequest#",
      },
    },
    url: "/api/v1/onboarding/reviews/:review_id/metadata",
  },
  {
    method: "POST",
    schema: {
      operationId: "saveOnboardingReviewVersion",
      security: [
        {
          onboarding_token: [],
        },
      ],
      response: {
        201: {
          $ref: "ReviewVersionSaveResult#",
          description: "Saved Repository-specific Review Version",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "ReviewVersionSaveRequest#",
      },
    },
    url: "/api/v1/onboarding/reviews/:review_id/versions",
  },
];
