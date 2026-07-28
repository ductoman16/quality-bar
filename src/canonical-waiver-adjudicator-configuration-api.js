import { closedObject } from "./canonical-schema.js";

const errorResponse = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
  description: "A secret-safe canonical error",
};

const mutationParameters = [
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

export function canonicalWaiverAdjudicatorConfigurationPath() {
  return {
    "/api/v1/waiver-adjudicator-configuration": {
      get: {
        operationId: "getWaiverAdjudicatorConfiguration",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WaiverAdjudicatorConfigurationState",
                },
              },
            },
            description: "Installation-wide Waiver Adjudicator Configuration",
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
      patch: {
        operationId: "updateWaiverAdjudicatorConfiguration",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CodexConfiguration" },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WaiverAdjudicatorConfigurationChange",
                },
              },
            },
            description: "Waiver Adjudicator Configuration change",
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
  };
}

export function canonicalWaiverAdjudicatorConfigurationSchemas() {
  return {
    WaiverAdjudicatorConfigurationState: {
      oneOf: [
        closedObject({ configured: { const: false, type: "boolean" } }, [
          "configured",
        ]),
        closedObject(
          {
            configuration: {
              $ref: "#/components/schemas/CodexConfiguration",
            },
            configured: { const: true, type: "boolean" },
          },
          ["configured", "configuration"],
        ),
      ],
    },
    WaiverAdjudicatorConfigurationChange: closedObject(
      {
        changed: { type: "boolean" },
        configuration: {
          $ref: "#/components/schemas/CodexConfiguration",
        },
      },
      ["changed", "configuration"],
    ),
  };
}
