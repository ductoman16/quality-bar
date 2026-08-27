import { randomUUID } from "node:crypto";

import AjvCompiler from "@fastify/ajv-compiler";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import Fastify from "fastify";

import { requireCodedError } from "./coded-error.ts";
import { canonicalFastifyValidationError } from "./fastify-validation-error.ts";
import { isProductSurface, isUnavailableError } from "./http-request.ts";
import { createErrorDocument, writeError, writeJson } from "./http-response.ts";
import { apiRoutes, apiSchemas } from "./http-routes/index.ts";

const JSON_TYPE = "application/json";
const createValidatorCompiler = AjvCompiler();
const buildSerializerFactory = SerializerSelector();

// The route response schemas are static and identical across every application
// instance in a process, so fast-json-stringify compiles byte-identical
// serializers each boot. Compiling them is ~98% of server startup cost, so a
// process-level cache keyed by the response schema lets repeated boots (every
// integration test that starts a fresh application) reuse the first compile.
const responseSerializerCache = new Map<
  string,
  (document: unknown) => string
>();

function cachedSerializerCompiler(
  compile: (options: any) => (document: unknown) => string,
): (options: any) => (document: unknown) => string {
  return (options) => {
    const key = JSON.stringify(options.schema);
    let serialize = responseSerializerCache.get(key);
    if (serialize === undefined) {
      serialize = compile(options);
      responseSerializerCache.set(key, serialize);
    }
    return serialize;
  };
}

function writeUnhandledError(reply: any, error: unknown) {
  const failure =
    error instanceof Error
      ? error
      : new TypeError("Request handler rejected with a non-Error", {
          cause: error,
        });
  const fastifyFailure = failure as any;
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
    const canonical = canonicalFastifyValidationError(
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

export function createFastify(
  components: ReturnType<
    typeof import("./canonical/schema.ts").createCanonicalComponents
  >,
): import("fastify").FastifyInstance {
  const registeredSchemas = Object.fromEntries(
    Object.entries({ ...components.schemas, ...apiSchemas }).map(
      ([id, schema]) => [id, { $id: id, ...schema }],
    ),
  );
  const server = Fastify({
    bodyLimit: 8 * 1024,
    exposeHeadRoutes: false,
    genReqId: () => randomUUID(),
    routerOptions: {
      maxParamLength: Number.MAX_SAFE_INTEGER,
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
  const validator = createValidatorCompiler(registeredSchemas, {
    customOptions: {
      allErrors: true,
      allowUnionTypes: true,
      coerceTypes: false,
      removeAdditional: false,
      strict: false,
      verbose: true,
    },
  });
  server.setValidatorCompiler(validator);
  server.setSerializerCompiler(
    cachedSerializerCompiler(buildSerializerFactory(registeredSchemas, {})),
  );
  server.register(cookie);
  server.register(swagger, {
    convertConstToEnum: false,
    openapi: {
      components: {
        securitySchemes: components.securitySchemes as any,
      },
      info: { title: "Quality Bar API", version: "1.0.0" },
      openapi: "3.1.0",
    },
    refResolver: {
      buildLocalReference: (schema, ...context) =>
        String(schema.$id ?? `schema-${context[2]}`),
    },
  });
  for (const schema of Object.values(registeredSchemas)) {
    server.addSchema(schema);
  }
  server.decorateRequest("authority", null);
  server.decorateRequest("onboardingGrant", null);
  server.addHook("preValidation", (request, reply, done) => {
    void reply;
    const query = request.query as Record<string, unknown>;
    const querySchema = request.routeOptions.schema?.querystring as {
      properties?: Record<string, { type?: string }>;
    };
    const properties = querySchema?.properties ?? {};
    for (const [name, schema] of Object.entries(properties)) {
      const value = query?.[name];
      if (
        schema.type === "integer" &&
        typeof value === "string" &&
        /^(0|[1-9]\d*)$/.test(value)
      ) {
        const integer = Number(value);
        if (Number.isSafeInteger(integer)) {
          query[name] = integer;
        }
      }
    }
    done();
  });
  server.addHook("onSend", (request, reply, payload, done) => {
    void request;
    if (reply.getHeader("content-type")?.toString().startsWith(JSON_TYPE)) {
      reply.header("content-type", JSON_TYPE);
    }
    done(null, payload);
  });
  server.setErrorHandler((error, request, reply) => {
    void request;
    writeUnhandledError(reply, error);
  });
  return server;
}

export function requestUrl(request: any) {
  return new URL(request.url, "http://quality-bar.internal");
}

export function allowedSecuritySchemes(request: any) {
  const declared = new Set(
    (request.routeOptions.schema?.security ?? []).flatMap(Object.keys),
  );
  return request.is404 && isProductSurface(requestUrl(request).pathname)
    ? new Set(["browser_session", "implementer_token"])
    : declared;
}

export function notReadyMessage(code: string) {
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

function registeredSchema(route: any) {
  if (route.schema.security === undefined) {
    throw new TypeError(
      `HTTP operation security is missing: ${route.schema.operationId ?? route.url}`,
    );
  }
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

export function registerApiRoutes(
  server: import("fastify").FastifyInstance,
  handlers: Record<string, (request: any, reply: any) => unknown>,
  errorHandlers: Record<
    string,
    (error: any, request: any, reply: any) => unknown
  > = {},
) {
  for (const route of apiRoutes) {
    const operationId = route.schema.operationId;
    const handler =
      operationId === "getOpenApiDocument"
        ? (
            request: import("fastify").FastifyRequest,
            reply: import("fastify").FastifyReply,
          ) => {
            void request;
            return reply.send(server.swagger());
          }
        : operationId === undefined
          ? (
              request: import("fastify").FastifyRequest,
              reply: import("fastify").FastifyReply,
            ) => {
              void request;
              writeError(reply, 404, "not_found", "Resource was not found");
            }
          : handlers[operationId];
    if (typeof handler !== "function") {
      throw new TypeError(`HTTP operation handler is missing: ${operationId}`);
    }
    server.route({
      ...route,
      ...(operationId && errorHandlers[operationId]
        ? { errorHandler: errorHandlers[operationId] }
        : {}),
      handler,
      schema: registeredSchema(route),
    } as any);
  }
}
