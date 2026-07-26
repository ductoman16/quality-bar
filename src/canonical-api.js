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

export function canonicalOpenApiDocument() {
  const codexCapabilityCatalog = readCodexCapabilityCatalog();
  const browserMutationParameters = [
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
  const browserOrBearerMutationParameters = browserMutationParameters.map(
    (parameter) => ({
      ...parameter,
      description: "Required when authenticating with a browser session",
      required: false,
    }),
  );

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
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
              },
            },
            required: true,
          },
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
      "/api/v1/session/logout": {
        post: {
          operationId: "logoutOperator",
          parameters: browserMutationParameters,
          responses: {
            204: { description: "Current browser session revoked" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/session/activity": {
        post: {
          operationId: "recordBrowserSessionActivity",
          parameters: browserMutationParameters,
          responses: {
            204: { description: "Browser session refreshed" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/session/password": {
        post: {
          operationId: "changeOperatorPassword",
          parameters: browserMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordChangeRequest" },
              },
            },
            required: true,
          },
          responses: {
            204: { description: "Password changed and sessions revoked" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            422: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/sessions/revoke": {
        post: {
          operationId: "revokeBrowserSessions",
          parameters: browserMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SessionRevocationRequest",
                },
              },
            },
            required: true,
          },
          responses: {
            204: { description: "All browser sessions revoked" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            422: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/implementer-token": {
        post: {
          operationId: "createImplementerToken",
          parameters: browserMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentPasswordRequest" },
              },
            },
            required: true,
          },
          responses: {
            201: { description: "One-time token reveal" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            409: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/implementer-token/rotate": {
        post: {
          operationId: "rotateImplementerToken",
          parameters: browserMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentPasswordRequest" },
              },
            },
            required: true,
          },
          responses: {
            200: { description: "One-time replacement token reveal" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            409: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/implementer-token/revoke": {
        post: {
          operationId: "revokeImplementerToken",
          parameters: browserMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentPasswordRequest" },
              },
            },
            required: true,
          },
          responses: {
            204: { description: "Implementer token revoked" },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            409: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
      "/api/v1/reviews": {
        post: {
          operationId: "createReview",
          parameters: browserOrBearerMutationParameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReviewCreateRequest" },
              },
            },
            required: true,
          },
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
          security: authenticated,
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
    components: {
      schemas: {
        AuthorityAttribution: {
          additionalProperties: true,
          properties: {
            action: { type: "string" },
            channel: {
              enum: ["browser_session", "implementer_token"],
              type: "string",
            },
            error_code: { type: "string" },
            id: { type: "string" },
            occurred_at: { format: "date-time", type: "string" },
            outcome: {
              enum: ["success", "failure", "forbidden"],
              type: "string",
            },
          },
          required: ["id", "channel", "action", "outcome", "occurred_at"],
          type: "object",
        },
        AuthorityAttributionCollection: {
          additionalProperties: true,
          properties: {
            items: {
              items: { $ref: "#/components/schemas/AuthorityAttribution" },
              type: "array",
            },
            next_cursor: { type: ["string", "null"] },
          },
          required: ["items", "next_cursor"],
          type: "object",
        },
        Error: {
          additionalProperties: true,
          properties: {
            code: { type: "string" },
            fields: {
              items: { $ref: "#/components/schemas/FieldError" },
              type: "array",
            },
            message: { type: "string" },
            request_id: { type: "string" },
          },
          required: ["code", "message", "request_id"],
          type: "object",
        },
        FieldError: {
          additionalProperties: true,
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            path: { type: "string" },
          },
          required: ["path", "code", "message"],
          type: "object",
        },
        ErrorResponse: {
          additionalProperties: true,
          properties: { error: { $ref: "#/components/schemas/Error" } },
          required: ["error"],
          type: "object",
        },
        CurrentPasswordRequest: {
          additionalProperties: false,
          properties: { password: { type: "string" } },
          required: ["password"],
          type: "object",
        },
        LoginRequest: {
          additionalProperties: false,
          properties: { password: { type: "string" } },
          required: ["password"],
          type: "object",
        },
        PasswordChangeRequest: {
          additionalProperties: false,
          properties: {
            current_password: { type: "string" },
            new_password: { type: "string" },
          },
          required: ["current_password", "new_password"],
          type: "object",
        },
        SessionRevocationRequest: {
          additionalProperties: false,
          properties: {
            confirmation: { const: "REVOKE ALL SESSIONS", type: "string" },
            password: { type: "string" },
          },
          required: ["confirmation", "password"],
          type: "object",
        },
        CodexConfiguration: {
          oneOf: codexCapabilityCatalog.models.map((model) => ({
            additionalProperties: false,
            properties: {
              model: { const: model.id, type: "string" },
              reasoning_effort: {
                enum: model.reasoning_efforts,
                type: "string",
              },
              service_tier: { enum: model.service_tiers, type: "string" },
            },
            required: ["model", "reasoning_effort", "service_tier"],
            type: "object",
          })),
        },
        CriterionCreateRequest: {
          additionalProperties: false,
          properties: {
            impact: { enum: ["advisory", "blocking"], type: "string" },
            instruction: { minLength: 1, pattern: "\\S", type: "string" },
          },
          required: ["impact", "instruction"],
          type: "object",
        },
        ReviewAssignment: {
          additionalProperties: false,
          properties: { scope: { const: "installation_wide", type: "string" } },
          required: ["scope"],
          type: "object",
        },
        ReviewCreateRequest: {
          additionalProperties: false,
          properties: {
            assignment: { $ref: "#/components/schemas/ReviewAssignment" },
            codex_configuration: {
              $ref: "#/components/schemas/CodexConfiguration",
            },
            criteria: {
              items: { $ref: "#/components/schemas/CriterionCreateRequest" },
              minItems: 1,
              type: "array",
            },
            description: { minLength: 1, pattern: "\\S", type: "string" },
            name: { minLength: 1, pattern: "\\S", type: "string" },
          },
          required: [
            "assignment",
            "codex_configuration",
            "criteria",
            "description",
            "name",
          ],
          type: "object",
        },
        Criterion: {
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            impact: { enum: ["advisory", "blocking"], type: "string" },
            instruction: { type: "string" },
            position: { minimum: 1, type: "integer" },
          },
          required: ["id", "impact", "instruction", "position"],
          type: "object",
        },
        ReviewVersion: {
          additionalProperties: false,
          properties: {
            codex_configuration: {
              $ref: "#/components/schemas/CodexConfiguration",
            },
            criteria: {
              items: { $ref: "#/components/schemas/Criterion" },
              minItems: 1,
              type: "array",
            },
            id: { type: "string" },
            number: { minimum: 1, type: "integer" },
          },
          required: ["id", "number", "codex_configuration", "criteria"],
          type: "object",
        },
        Review: {
          additionalProperties: false,
          properties: {
            active_version: { $ref: "#/components/schemas/ReviewVersion" },
            assignment: { $ref: "#/components/schemas/ReviewAssignment" },
            description: { type: "string" },
            id: { type: "string" },
            name: { type: "string" },
          },
          required: [
            "id",
            "name",
            "description",
            "assignment",
            "active_version",
          ],
          type: "object",
        },
        System: {
          additionalProperties: true,
          properties: {
            bootstrap: { $ref: "#/components/schemas/BootstrapFact" },
            browser_sessions: {
              $ref: "#/components/schemas/BrowserSessionsFact",
            },
            codex: { $ref: "#/components/schemas/CodexFact" },
            durable_core: { $ref: "#/components/schemas/DurableCoreFact" },
            implementer_token: {
              $ref: "#/components/schemas/ImplementerTokenFact",
            },
          },
          required: [
            "bootstrap",
            "browser_sessions",
            "codex",
            "durable_core",
            "implementer_token",
          ],
          type: "object",
        },
        BootstrapFact: {
          additionalProperties: true,
          properties: {
            status: { enum: ["complete", "required"], type: "string" },
          },
          required: ["status"],
          type: "object",
        },
        BrowserSessionsFact: {
          additionalProperties: true,
          properties: {
            active_count: { minimum: 0, type: "integer" },
            status: { const: "available", type: "string" },
          },
          required: ["active_count", "status"],
          type: "object",
        },
        CodexFact: {
          additionalProperties: true,
          properties: {
            catalog: { $ref: "#/components/schemas/CodexCapabilityCatalog" },
            error: { type: "string" },
            status: { enum: ["available", "unavailable"], type: "string" },
          },
          required: ["catalog", "status"],
          type: "object",
        },
        CodexCapabilityCatalog: {
          additionalProperties: false,
          const: codexCapabilityCatalog,
          properties: {
            codex_cli_version: {
              const: codexCapabilityCatalog.codex_cli_version,
              type: "string",
            },
            models: {
              items: { $ref: "#/components/schemas/CodexModelCapability" },
              minItems: 1,
              type: "array",
            },
          },
          required: ["codex_cli_version", "models"],
          type: "object",
        },
        CodexModelCapability: {
          oneOf: codexCapabilityCatalog.models.map((model) => ({
            additionalProperties: false,
            properties: {
              id: { const: model.id, type: "string" },
              reasoning_efforts: {
                items: { enum: model.reasoning_efforts, type: "string" },
                minItems: 1,
                type: "array",
              },
              service_tiers: {
                items: { enum: model.service_tiers, type: "string" },
                minItems: 1,
                type: "array",
              },
            },
            required: ["id", "reasoning_efforts", "service_tiers"],
            type: "object",
          })),
        },
        DurableCoreFact: {
          additionalProperties: true,
          properties: {
            schema_version: { minimum: 1, type: "integer" },
            status: { const: "ready", type: "string" },
          },
          required: ["schema_version", "status"],
          type: "object",
        },
        ImplementerTokenFact: {
          additionalProperties: true,
          properties: {
            status: { enum: ["active", "revoked"], type: "string" },
          },
          required: ["status"],
          type: "object",
        },
      },
      securitySchemes: {
        browser_session: {
          in: "cookie",
          name: "quality_bar_session",
          type: "apiKey",
        },
        implementer_token: { scheme: "bearer", type: "http" },
      },
    },
  };
}
