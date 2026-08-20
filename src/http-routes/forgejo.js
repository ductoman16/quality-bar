import { forgejoConnectionSchema } from "../forgejo-connection-http-schema.js";

export const forgejoSchemas = {
  GetForgejoConnection200Response: {
    anyOf: [{ $ref: "ForgejoConnection#" }, { type: "null" }],
  },
  ForgejoConnection: forgejoConnectionSchema,
  VerifyForgejoV16ConnectionRequest: {
    additionalProperties: false,
    properties: {
      base_url: { format: "uri", type: "string" },
      repository_ids: {
        items: { minimum: 1, type: "integer" },
        minItems: 1,
        type: "array",
        uniqueItems: true,
      },
      token: { minLength: 1, type: "string", writeOnly: true },
    },
    required: ["base_url", "repository_ids", "token"],
    type: "object",
  },
  DiscoverForgejoV16Repositories200Response: {
    items: { type: "object" },
    minItems: 1,
    type: "array",
  },
  DiscoverForgejoV16RepositoriesRequest: {
    additionalProperties: false,
    properties: {
      base_url: { format: "uri", type: "string" },
      token: { minLength: 1, type: "string", writeOnly: true },
    },
    required: ["base_url", "token"],
    type: "object",
  },
  RotateForgejoConnectionPatRequest: {
    additionalProperties: false,
    properties: {
      token: { minLength: 1, type: "string", writeOnly: true },
    },
    required: ["token"],
    type: "object",
  },
  DeleteNeverUsedForgejoConnectionRequest: {
    additionalProperties: false,
    maxProperties: 0,
    type: "object",
  },
};

import { errorResponses } from "../http-route-schema.js";

export const forgejoRoutes = [
  {
    method: "GET",
    schema: {
      operationId: "getForgejoConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GetForgejoConnection200Response#",
          description: "The single verified Forgejo v16 Connection",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
    },
    url: "/api/v1/forgejo-connections",
  },
  {
    method: "POST",
    schema: {
      operationId: "verifyForgejoV16Connection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          $ref: "ForgejoConnection#",
          description:
            "Atomically verified Forgejo Connection and selected Repositories",
        },
        ...errorResponses(400, 401, 403, 409, 422, 500, 503),
      },
      body: {
        $ref: "VerifyForgejoV16ConnectionRequest#",
      },
    },
    url: "/api/v1/forgejo-connections",
  },
  {
    method: "POST",
    schema: {
      operationId: "discoverForgejoV16Repositories",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "DiscoverForgejoV16Repositories200Response#",
          description:
            "Verified accessible Forgejo Repositories for explicit selection",
        },
        ...errorResponses(400, 401, 403, 422, 500, 503),
      },
      body: {
        $ref: "DiscoverForgejoV16RepositoriesRequest#",
      },
    },
    url: "/api/v1/forgejo-connections/discover",
  },
  {
    method: "POST",
    schema: {
      operationId: "rotateForgejoConnectionPat",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ForgejoConnection#",
          description:
            "Replacement Forgejo PAT verified and atomically activated",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "RotateForgejoConnectionPatRequest#",
      },
    },
    url: "/api/v1/forgejo-connections/credential/rotate",
  },
  {
    method: "DELETE",
    schema: {
      operationId: "deleteNeverUsedForgejoConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          type: "null",
          description: "Never-used Forgejo Connection permanently deleted",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "DeleteNeverUsedForgejoConnectionRequest#",
      },
    },
    url: "/api/v1/forgejo-connections/lifecycle",
  },
  {
    method: "PATCH",
    schema: {
      operationId: "retireForgejoConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ForgejoConnection#",
          description:
            "Forgejo Connection retired after every dependent Repository retired",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "GitHubConnectionRetirementRequest#",
      },
    },
    url: "/api/v1/forgejo-connections/lifecycle",
  },
  {
    method: "POST",
    schema: {
      operationId: "reactivateForgejoConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ForgejoConnection#",
          description:
            "Retired Forgejo Connection completely reverified and reactivated",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "RotateForgejoConnectionPatRequest#",
      },
    },
    url: "/api/v1/forgejo-connections/reactivate",
  },
];
