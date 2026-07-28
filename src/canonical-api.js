import { createCanonicalComponents } from "./canonical-api-components.js";
import { canonicalReviewAssignmentPath } from "./canonical-review-assignment-api.js";
import { canonicalReviewArchivalPath } from "./canonical-review-archival-api.js";
import { canonicalRepositoryPath } from "./canonical-repository-api.js";
import { canonicalGitHubConnectionPaths } from "./canonical-github-connection-api.js";
import { canonicalForgejoConnectionPaths } from "./canonical-forgejo-connection-api.js";
import { readCodexCapabilityCatalog } from "./codex-capabilities.js";

const errorResponse = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
  description: "A secret-safe canonical error",
};

const authenticated = [{ browser_session: [] }, { implementer_token: [] }];

function browserMutationParameters() {
  return [
    {
      in: "header",
      name: "Origin",
      required: true,
      schema: { format: "uri", type: "string" },
    },
    {
      in: "header",
      name: "x-quality-bar-csrf",
      required: true,
      schema: { type: "string" },
    },
  ];
}

/**
 * @typedef {{
 *   content?: { "application/json": { schema: { $ref: string } } },
 *   description: string
 * }} OpenApiResponse
 */
/**
 * @typedef {{
 *   content: { "application/json": { schema: { $ref: string } } },
 *   required: boolean
 * }} OpenApiRequestBody
 */

/**
 * @param {string} path
 * @param {string} operationId
 * @param {Record<number, OpenApiResponse>} responses
 * @param {OpenApiRequestBody} [requestBody]
 */
function sessionMutation(path, operationId, responses, requestBody) {
  return {
    [path]: {
      post: {
        operationId,
        parameters: browserMutationParameters(),
        ...(requestBody ? { requestBody } : {}),
        responses,
        security: [{ browser_session: [] }],
      },
    },
  };
}

/** @param {string} schema */
const jsonRequest = (schema) => ({
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
  required: true,
});

export function canonicalOpenApiDocument() {
  const codexCapabilityCatalog = readCodexCapabilityCatalog();
  const mutationParameters = browserMutationParameters();
  return {
    info: { title: "Quality Bar API", version: "1.0.0" },
    jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    openapi: "3.1.0",
    paths: {
      "/api/v1/openapi.json": {
        get: {
          operationId: "getOpenApiDocument",
          responses: {
            200: {
              content: { "application/json": { schema: { type: "object" } } },
              description: "OpenAPI document",
            },
            400: errorResponse,
            401: errorResponse,
          },
          security: authenticated,
        },
      },
      "/api/v1/session/login": {
        post: {
          operationId: "loginOperator",
          requestBody: jsonRequest("LoginRequest"),
          responses: {
            204: { description: "Authenticated browser session" },
            400: errorResponse,
            401: errorResponse,
            429: errorResponse,
            503: errorResponse,
          },
          security: [],
        },
      },
      ...sessionMutation("/api/v1/session/logout", "logoutOperator", {
        204: { description: "Current browser session revoked" },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        503: errorResponse,
      }),
      ...sessionMutation(
        "/api/v1/session/activity",
        "recordBrowserSessionActivity",
        {
          204: { description: "Browser session refreshed" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          503: errorResponse,
        },
      ),
      ...sessionMutation(
        "/api/v1/session/password",
        "changeOperatorPassword",
        {
          204: { description: "Password changed and sessions revoked" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        jsonRequest("PasswordChangeRequest"),
      ),
      ...sessionMutation(
        "/api/v1/sessions/revoke",
        "revokeBrowserSessions",
        {
          204: { description: "All browser sessions revoked" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        jsonRequest("SessionRevocationRequest"),
      ),
      ...sessionMutation(
        "/api/v1/implementer-token",
        "createImplementerToken",
        {
          201: { description: "One-time token reveal" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
        jsonRequest("CurrentPasswordRequest"),
      ),
      ...sessionMutation(
        "/api/v1/implementer-token/rotate",
        "rotateImplementerToken",
        {
          200: { description: "One-time replacement token reveal" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
        jsonRequest("CurrentPasswordRequest"),
      ),
      ...sessionMutation(
        "/api/v1/implementer-token/revoke",
        "revokeImplementerToken",
        {
          204: { description: "Implementer token revoked" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
        jsonRequest("CurrentPasswordRequest"),
      ),
      "/api/v1/reviews": {
        get: {
          operationId: "listReviews",
          parameters: [
            {
              in: "query",
              name: "state",
              schema: {
                default: "active",
                enum: ["active", "archived"],
                type: "string",
              },
            },
          ],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReviewCollection" },
                },
              },
              description: "Review lineage collection",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
        post: {
          operationId: "createReview",
          parameters: mutationParameters,
          requestBody: jsonRequest("ReviewCreateRequest"),
          responses: {
            201: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Review" },
                },
              },
              description: "Review with its active immutable v1",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            422: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      ...canonicalRepositoryPath(mutationParameters, errorResponse),
      ...canonicalGitHubConnectionPaths(mutationParameters, errorResponse),
      ...canonicalForgejoConnectionPaths(mutationParameters, errorResponse),
      ...canonicalReviewAssignmentPath(mutationParameters, errorResponse),
      ...canonicalReviewArchivalPath(mutationParameters, errorResponse),
      "/api/v1/reviews/{review_id}/metadata": {
        patch: {
          operationId: "updateReviewMetadata",
          parameters: [
            {
              in: "path",
              name: "review_id",
              required: true,
              schema: { minLength: 1, type: "string" },
            },
            ...mutationParameters,
          ],
          requestBody: jsonRequest("ReviewMetadataUpdateRequest"),
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Review" },
                },
              },
              description: "Review with updated lineage metadata",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
            422: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/reviews/{review_id}/versions": {
        post: {
          operationId: "saveReviewVersion",
          parameters: [
            {
              in: "path",
              name: "review_id",
              required: true,
              schema: { minLength: 1, type: "string" },
            },
            ...mutationParameters,
          ],
          requestBody: jsonRequest("ReviewVersionSaveRequest"),
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ReviewVersionSaveResult",
                  },
                },
              },
              description:
                "Review with the newly active or unchanged immutable version",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
            422: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/reviews/{review_id}/active-version": {
        patch: {
          operationId: "reactivateReviewVersion",
          parameters: [
            {
              in: "path",
              name: "review_id",
              required: true,
              schema: { minLength: 1, type: "string" },
            },
            ...mutationParameters,
          ],
          requestBody: jsonRequest("ReviewVersionReactivationRequest"),
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ReviewVersionReactivationResult",
                  },
                },
              },
              description:
                "Review with the selected compatible immutable version active",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            404: errorResponse,
            409: errorResponse,
            422: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/system": {
        get: {
          operationId: "getSystem",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/System" },
                },
              },
              description: "System facts",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            500: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/system/authority-attributions": {
        get: {
          operationId: "listAuthorityAttributions",
          parameters: [
            { in: "query", name: "cursor", schema: { type: "string" } },
            {
              in: "query",
              name: "limit",
              schema: { maximum: 100, minimum: 1, type: "integer" },
            },
          ],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthorityAttributionCollection",
                  },
                },
              },
              description: "Attribution collection",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
    },
    components: createCanonicalComponents(codexCapabilityCatalog),
  };
}
