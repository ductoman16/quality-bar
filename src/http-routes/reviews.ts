import {
  browserMutationHeaders,
  canonicalValidationError,
  errorResponses,
} from "../http-route-schema.ts";

export const reviewsSchemas = {};

export const reviewsRoutes = [
  {
    method: "GET",
    schema: {
      ...canonicalValidationError(
        "review_list_state_invalid",
        "Review collection state must be active or archived",
        400,
      ),
      operationId: "listReviews",
      security: [
        {
          browser_session: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewCollection#",
          description: "Review lineage collection",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          state: {
            default: "active",
            enum: ["active", "archived"],
            type: "string",
          },
        },
        required: [],
        type: "object",
      },
    },
    url: "/api/v1/reviews",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "review_request_malformed",
        "Review request contains unsupported or missing fields",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "createReview",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          $ref: "Review#",
          description: "Review with its active immutable v1",
        },
        ...errorResponses(400, 401, 403, 422, 500, 503),
      },
      body: {
        $ref: "ReviewCreateRequest#",
      },
    },
    url: "/api/v1/reviews",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "review_assignment_malformed",
        "Review Assignment must contain exactly one supported scope",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "setReviewAssignment",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewAssignmentChangeResult#",
          description:
            "Review Assignment changed atomically without changing executable content",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "ReviewAssignment#",
      },
    },
    url: "/api/v1/reviews/:review_id/assignment",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "review_archival_request_malformed",
        "Review archival request must contain only an exact archived state",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "setReviewArchived",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewArchivalResult#",
          description:
            "Review archived or restored with its active version and history preserved",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "ReviewArchivalRequest#",
      },
    },
    url: "/api/v1/reviews/:review_id/archival",
  },
  {
    method: "DELETE",
    schema: {
      ...canonicalValidationError(
        "review_deletion_request_malformed",
        "Review deletion request must be an empty object",
        400,
      ),
      headers: browserMutationHeaders(),
      operationId: "deleteNeverUsedReview",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          type: "null",
          description: "Complete never-used Review lineage deleted",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "DeleteNeverUsedRepositoryRequest#",
      },
    },
    url: "/api/v1/reviews/:review_id",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "review_metadata_request_malformed",
        "Review metadata request contains unsupported or missing fields",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "updateReviewMetadata",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Review#",
          description: "Review with updated lineage metadata",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "ReviewMetadataUpdateRequest#",
      },
    },
    url: "/api/v1/reviews/:review_id/metadata",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "review_version_request_malformed",
        "Review Version request contains unsupported or missing fields",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "saveReviewVersion",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewVersionSaveResult#",
          description:
            "Review with the newly active or unchanged immutable version",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "ReviewVersionSaveRequest#",
      },
    },
    url: "/api/v1/reviews/:review_id/versions",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "review_version_reactivation_request_malformed",
        "Review Version reactivation request must contain only an exact Review Version identity",
        422,
      ),
      headers: browserMutationHeaders(),
      operationId: "reactivateReviewVersion",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewVersionReactivationResult#",
          description:
            "Review with the selected compatible immutable version active",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "ReviewVersionReactivationRequest#",
      },
    },
    url: "/api/v1/reviews/:review_id/active-version",
  },
];
