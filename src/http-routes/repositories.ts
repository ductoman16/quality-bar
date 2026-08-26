import {
  canonicalValidationError,
  errorResponses,
} from "../http-route-schema.ts";

export const repositoriesSchemas = {
  DeleteNeverUsedRepositoryRequest: {
    additionalProperties: false,
    properties: {},
    type: "object",
  },
};

export const repositoriesRoutes = [
  {
    method: "DELETE",
    schema: {
      operationId: "deleteNeverUsedRepository",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          type: "null",
          description: "Never-used unreferenced Repository deleted",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "DeleteNeverUsedRepositoryRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "repository_request_invalid",
        "Repository registration request is invalid",
        422,
      ),
      operationId: "registerGenericRepository",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Repository#",
          description: "Verified Generic HTTPS Repository",
        },
        ...errorResponses(400, 401, 403, 409, 422, 500, 503),
      },
      body: {
        $ref: "GenericRepositoryRegistrationRequest#",
      },
    },
    url: "/api/v1/repositories",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "repository_request_invalid",
        "Repository credential rotation request is invalid",
        422,
      ),
      operationId: "rotateGenericRepositoryCredential",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Repository#",
          description: "Repository with its verified replacement credential",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "GenericRepositoryCredentialRotationRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id/credential/rotate",
  },
  {
    method: "GET",
    schema: {
      headers: {
        additionalProperties: true,
        properties: { "if-none-match": { type: "string" } },
        type: "object",
      },
      operationId: "getRepositoryGuidance",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "RepositoryGuidance#",
          description: "Complete current Repository Guidance",
        },
        304: {
          type: "null",
          description: "Repository Guidance is unchanged",
        },
        ...errorResponses(400, 401, 403, 404, 500, 503),
      },
    },
    url: "/api/v1/repositories/:repository_id/guidance",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "repository_lifecycle_request_invalid",
        "Repository lifecycle request is invalid",
        422,
      ),
      operationId: "setRepositoryLifecycle",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Repository#",
          description:
            "Repository with separate operator lifecycle and observed health",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "RepositoryLifecycleRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id/lifecycle",
  },
];
