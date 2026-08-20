import { randomUUID } from "node:crypto";

import AjvCompiler from "@fastify/ajv-compiler";
import swagger from "@fastify/swagger";
import Fastify from "fastify";

import { requireCodedError } from "./coded-error.js";
import { canonicalFastifyValidationError } from "./fastify-validation-error.js";
import { isUnavailableError } from "./http-request.js";
import { createErrorDocument, writeError, writeJson } from "./http-response.js";
import { apiRoutes, apiSchemas } from "./http-routes/index.js";

const JSON_TYPE = "application/json";
const createValidatorCompiler = AjvCompiler();
const OPENAPI_HEADER_NAMES = {
  "idempotency-key": "Idempotency-Key",
  "if-none-match": "If-None-Match",
  origin: "Origin",
};

/** @param {any} reply @param {unknown} error */
function writeUnhandledError(reply, error) {
  const failure =
    error instanceof Error
      ? error
      : new TypeError("Request handler rejected with a non-Error", {
          cause: error,
        });
  const fastifyFailure = /** @type {any} */ (failure);
  if (reply.raw.headersSent) {
    reply.raw.destroy(failure);
  } else if (
    reply.request.url.startsWith("/mcp/v1") &&
    fastifyFailure.code?.startsWith("FST_ERR_CTP_")
  ) {
    writeJson(reply, 200, {
      error: {
        code:
          fastifyFailure.code === "FST_ERR_CTP_INVALID_JSON_BODY"
            ? -32700
            : -32600,
        message:
          fastifyFailure.code === "FST_ERR_CTP_INVALID_JSON_BODY"
            ? "Parse error"
            : "Invalid Request",
      },
      id: null,
      jsonrpc: "2.0",
    });
  } else if (isUnavailableError(failure)) {
    const unavailable = requireCodedError(failure);
    writeError(reply, 503, unavailable.code, unavailable.message);
  } else if (fastifyFailure.validation) {
    const canonical = fastifyFailure.validation.some(
      (/** @type {any} */ diagnostic) =>
        diagnostic.keyword === "maximum" &&
        diagnostic.instancePath.endsWith("/limit"),
    )
      ? {
          code: "page_size_invalid",
          message: "Page size is invalid",
          status: 400,
        }
      : reply.request.routeOptions.schema.operationId === "getAnalytics" &&
          !fastifyFailure.validation.some(
            (/** @type {any} */ diagnostic) =>
              diagnostic.keyword === "additionalProperties",
          )
        ? {
            code: "analytics_filter_invalid",
            message: "Analytics filter is invalid",
            status: 400,
          }
        : canonicalFastifyValidationError(
            reply.request,
            fastifyFailure.validation,
          );
    writeError(reply, canonical.status, canonical.code, canonical.message);
  } else if (
    fastifyFailure.code?.startsWith("FST_ERR_CTP_") ||
    fastifyFailure.code === "FST_ERR_BAD_URL"
  ) {
    writeError(reply, 400, "request_malformed", "Request is malformed");
  } else {
    writeError(reply, 500, "internal_error", "Internal server error");
  }
}

/**
 * @param {ReturnType<typeof import("./canonical-api-components.js").createCanonicalComponents>} components
 * @returns {import("fastify").FastifyInstance}
 */
export function createFastify(components) {
  const registeredSchemas = Object.fromEntries(
    Object.entries({ ...components.schemas, ...apiSchemas }).map(
      ([id, schema]) => [id, { $id: id, ...schema }],
    ),
  );
  const server = Fastify({
    bodyLimit: 8 * 1024,
    genReqId: () => randomUUID(),
    routerOptions: {
      onBadUrl(path, request, response) {
        void path;
        void request;
        const body = JSON.stringify(
          createErrorDocument("request_malformed", "Request is malformed"),
        );
        response.writeHead(400, { "content-type": JSON_TYPE });
        response.end(body);
      },
    },
  });
  const validatorOptions = /** @type {const} */ ({
    customOptions: {
      allErrors: true,
      allowUnionTypes: true,
      removeAdditional: false,
      strict: false,
    },
  });
  const bodyValidator = createValidatorCompiler(registeredSchemas, {
    ...validatorOptions,
    customOptions: { ...validatorOptions.customOptions, coerceTypes: false },
  });
  const otherValidator = createValidatorCompiler(registeredSchemas, {
    ...validatorOptions,
    customOptions: { ...validatorOptions.customOptions, coerceTypes: true },
  });
  server.setValidatorCompiler((request) =>
    (["body", "querystring"].includes(request.httpPart ?? "")
      ? bodyValidator
      : otherValidator)(request),
  );
  server.register(swagger, {
    convertConstToEnum: false,
    openapi: {
      components: {
        securitySchemes: /** @type {any} */ (components.securitySchemes),
      },
      info: { title: "Quality Bar API", version: "1.0.0" },
      openapi: "3.1.0",
    },
    refResolver: {
      buildLocalReference: (schema, ...context) =>
        String(schema.$id ?? `schema-${context[2]}`),
    },
    transformObject: (/** @type {any} */ { openapiObject }) => {
      for (const path of Object.values(openapiObject.paths)) {
        for (const operation of Object.values(/** @type {any} */ (path))) {
          for (const parameter of /** @type {any} */ (operation).parameters ??
            []) {
            if (parameter.in === "header") {
              parameter.name =
                OPENAPI_HEADER_NAMES[
                  /** @type {keyof typeof OPENAPI_HEADER_NAMES} */ (
                    parameter.name
                  )
                ] ?? parameter.name;
            }
          }
          /** @type {any} */ (operation).parameters?.sort(
            (/** @type {any} */ left, /** @type {any} */ right) =>
              (left.in === "path" ? 0 : 1) - (right.in === "path" ? 0 : 1),
          );
        }
      }
      return {
        ...openapiObject,
        jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
      };
    },
  });
  for (const schema of Object.values(registeredSchemas)) {
    server.addSchema(schema);
  }
  server.setSerializerCompiler(() => JSON.stringify);
  server.decorateRequest("authority", null);
  server.decorateRequest("onboardingGrant", null);
  server.addHook("onSend", (request, reply, payload, done) => {
    void request;
    if (reply.getHeader("content-type")?.toString().startsWith(JSON_TYPE)) {
      reply.header("content-type", JSON_TYPE);
    }
    done(null, payload);
  });
  server.setNotFoundHandler((request, reply) => {
    void request;
    writeError(reply, 404, "not_found", "Resource was not found");
  });
  server.setErrorHandler((error, request, reply) => {
    void request;
    writeUnhandledError(reply, error);
  });
  return server;
}

/** @param {any} request */
export function requestUrl(request) {
  return new URL(request.url, "http://quality-bar.internal");
}

/** @param {any} request */
export function allowedSecuritySchemes(request) {
  return new Set(
    (request.routeOptions.schema?.security ?? []).flatMap(Object.keys),
  );
}

/** @param {string} code */
export function notReadyMessage(code) {
  switch (code) {
    case "storage_unavailable":
      return "Quality Bar is not ready — storage is unavailable. Verify the data volume is mounted and writable and that free space is available, then restart the service.";
    case "installation_not_ready":
      return "Quality Bar is not ready — installation is not ready. Complete first-time setup (configuration, master key, and operator password bootstrap) and restart.";
    case "codex_termination_failed":
      return "Quality Bar is not ready — Codex execution terminated unexpectedly. Review codex logs and restart the service.";
    case "application_shutdown_failed":
      return "Quality Bar is not ready — application shutdown failed. Check logs for the shutdown error and restart.";
    case "schema_invalid":
      return "Quality Bar is not ready — schema is invalid. The data volume was created by a newer code version; recreate the volume with the current code or restore a compatible backup, then restart.";
    default:
      return `Quality Bar is not ready — ${code}. Check server logs and /health/ready for the error code and restart after addressing the underlying condition.`;
  }
}

/** @param {any} route */
function registeredSchema(route) {
  const schema = {
    querystring: route.schema.querystring ?? {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
    ...route.schema,
  };
  const pathParameters = [...route.url.matchAll(/:([a-z_]+)/g)].map(
    (match) => match[1],
  );
  if (pathParameters.length > 0 && schema.params === undefined) {
    schema.params = {
      additionalProperties: false,
      properties: Object.fromEntries(
        pathParameters.map((name) => [name, { minLength: 1, type: "string" }]),
      ),
      required: pathParameters,
      type: "object",
    };
  }
  const schemes = new Set((schema.security ?? []).flatMap(Object.keys));
  if (
    schema.headers === undefined &&
    schemes.has("browser_session") &&
    ["DELETE", "PATCH", "POST", "PUT"].includes(route.method)
  ) {
    schema.headers = {
      additionalProperties: true,
      ...(schemes.size === 1
        ? { required: ["origin", "x-quality-bar-csrf"] }
        : {
            anyOf: [
              { required: ["authorization"] },
              { required: ["origin", "x-quality-bar-csrf"] },
            ],
          }),
      properties: {
        origin: { format: "uri", type: "string" },
        "x-quality-bar-csrf": { type: "string" },
      },
      type: "object",
    };
  }
  return schema;
}

/**
 * @param {import("fastify").FastifyInstance} server
 * @param {Record<string, (request: any, reply: any) => unknown>} handlers
 */
export function registerApiRoutes(server, handlers) {
  for (const route of apiRoutes) {
    const operationId = route.schema.operationId;
    const handler =
      operationId === "getOpenApiDocument"
        ? (
            /** @type {import("fastify").FastifyRequest} */ request,
            /** @type {import("fastify").FastifyReply} */ reply,
          ) => {
            void request;
            return reply.send(server.swagger());
          }
        : operationId === undefined
          ? (
              /** @type {import("fastify").FastifyRequest} */ request,
              /** @type {import("fastify").FastifyReply} */ reply,
            ) => {
              void request;
              writeError(reply, 404, "not_found", "Resource was not found");
            }
          : handlers[operationId];
    if (typeof handler !== "function") {
      throw new TypeError(`HTTP operation handler is missing: ${operationId}`);
    }
    server.route(
      /** @type {any} */ ({
        ...route,
        handler,
        schema: registeredSchema(route),
      }),
    );
  }
}
