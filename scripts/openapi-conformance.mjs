import { Validator } from "@seriousme/openapi-schema-validator";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const JsonSchemaValidator =
  /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
const addJsonSchemaFormats =
  /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );

const HTTP_METHODS = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
];
const JSON_CONTENT_TYPE = "application/json";
const CANONICAL_ERROR_REF = "#/components/schemas/ErrorResponse";

/** @param {unknown} value */
function asRecord(value) {
  return value && typeof value === "object"
    ? /** @type {Record<string, any>} */ (value)
    : {};
}

/** @param {string | undefined} instancePath @param {string | undefined} message */
function diagnostic(instancePath, message) {
  return `${instancePath || "/"} ${message ?? "is invalid"}`;
}

/** @param {unknown} document */
export async function validateOpenApi31Document(document) {
  const contract = asRecord(document);
  if (
    typeof contract.openapi !== "string" ||
    !/^3\.1(?:\.\d+)?$/.test(contract.openapi)
  ) {
    throw new Error(
      `openapi_structure_unsupported_version: expected 3.1.x; received ${String(contract.openapi)}`,
    );
  }

  const validator = new Validator({ allErrors: true });
  const result = await validator.validate(structuredClone(contract));
  if (!result.valid) {
    const rawError = Array.isArray(result.errors)
      ? result.errors[0]
      : result.errors;
    const error =
      typeof rawError === "string"
        ? { instancePath: "", message: rawError }
        : rawError;
    throw new Error(
      `openapi_structure_invalid: ${diagnostic(error?.instancePath, error?.message)}`,
    );
  }
  if (validator.version !== "3.1") {
    throw new Error(
      `openapi_structure_unsupported_version: expected 3.1.x; received ${String(validator.version)}`,
    );
  }
  try {
    validator.resolveRefs();
  } catch (error) {
    throw new Error(
      `openapi_structure_invalid: / ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let operations = 0;
  let responseStatuses = 0;
  for (const pathItem of Object.values(asRecord(contract.paths))) {
    const methods = asRecord(pathItem);
    for (const method of HTTP_METHODS) {
      if (methods[method]) {
        operations += 1;
        responseStatuses += Object.keys(
          asRecord(asRecord(methods[method]).responses),
        ).length;
      }
    }
  }
  return {
    documents: 1,
    operations,
    responseStatuses,
    version: contract.openapi,
  };
}

/** @param {ConstructorParameters<typeof Headers>[0]} headers @param {string} name */
function headerValue(headers, name) {
  return new Headers(headers).get(name);
}

/** @param {Record<string, any>} document @param {unknown} schema */
function schemaValidator(document, schema) {
  const ajv = new JsonSchemaValidator({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addJsonSchemaFormats(ajv);
  if (typeof schema === "boolean") {
    return ajv.compile(schema);
  }
  return ajv.compile({
    components: document.components,
    ...asRecord(schema),
  });
}

/** @param {string | undefined} body @param {string} owner */
function parseJson(body, owner) {
  try {
    return JSON.parse(body ?? "");
  } catch {
    throw new Error(`${owner}: / must be valid JSON`);
  }
}

/**
 * @typedef {{
 *   request: {
 *     body?: string,
 *     headers?: ConstructorParameters<typeof Headers>[0],
 *     method?: string,
 *     url: string,
 *   },
 *   response: Response,
 * }} HttpExchange
 */

/** @param {Record<string, any>} document */
export async function createHttpConformanceAssertion(document) {
  await validateOpenApi31Document(document);
  const facts = {
    canonicalErrors: 0,
    exchanges: 0,
    operations: new Set(),
    requestDocuments: 0,
    responseDocuments: 0,
    statuses: new Set(),
  };

  /**
   * @param {HttpExchange} exchange
   * @param {boolean} skipRequestDocument
   */
  async function assertExchangeInternal(
    { request, response },
    skipRequestDocument,
  ) {
    const method = (request.method ?? "GET").toLowerCase();
    const methodLabel = method.toUpperCase();
    const path = new URL(request.url).pathname;
    const operation = asRecord(asRecord(document.paths)[path])[method];

    if (!operation) {
      if (response.status !== 404) {
        throw new Error(
          `openapi_operation_undocumented: ${methodLabel} ${path} returned ${response.status}`,
        );
      }
      await assertJsonResponse(
        document,
        CANONICAL_ERROR_REF,
        response,
        `openapi_canonical_error_invalid: ${methodLabel} ${path} status 404`,
      );
      facts.canonicalErrors += 1;
      recordFacts(facts, methodLabel, path, response.status);
      return;
    }

    const requestBody = asRecord(operation.requestBody);
    if (requestBody.content && !skipRequestDocument) {
      const contentType = headerValue(request.headers, "content-type");
      if (contentType !== JSON_CONTENT_TYPE) {
        throw new Error(
          `openapi_request_content_type_invalid: ${methodLabel} ${path} expected ${JSON_CONTENT_TYPE}; received ${String(contentType)}`,
        );
      }
      const schema = asRecord(
        asRecord(requestBody.content)[JSON_CONTENT_TYPE],
      ).schema;
      const validate = schemaValidator(document, schema);
      const body = parseJson(
        request.body,
        `openapi_request_document_invalid: ${methodLabel} ${path}`,
      );
      if (!validate(body)) {
        const [error] = validate.errors ?? [];
        throw new Error(
          `openapi_request_document_invalid: ${methodLabel} ${path} ${diagnostic(error?.instancePath, error?.message)}`,
        );
      }
      facts.requestDocuments += 1;
    }

    const responseContract = asRecord(operation.responses)[response.status];
    if (!responseContract) {
      throw new Error(
        `openapi_status_unsupported: ${methodLabel} ${path} returned ${response.status}`,
      );
    }
    const responseContent = asRecord(responseContract.content);
    const jsonMediaType = asRecord(responseContent[JSON_CONTENT_TYPE]);
    const jsonSchema = jsonMediaType.schema;
    const hasJsonSchema = Object.hasOwn(jsonMediaType, "schema");
    if (response.status >= 400) {
      if (asRecord(jsonSchema).$ref !== CANONICAL_ERROR_REF) {
        throw new Error(
          `openapi_canonical_error_contract_invalid: ${methodLabel} ${path} status ${response.status}`,
        );
      }
      await assertJsonResponse(
        document,
        jsonSchema,
        response,
        `openapi_canonical_error_invalid: ${methodLabel} ${path} status ${response.status}`,
      );
      facts.canonicalErrors += 1;
      facts.responseDocuments += 1;
    } else if (hasJsonSchema) {
      await assertJsonResponse(
        document,
        jsonSchema,
        response,
        `openapi_success_document_invalid: ${methodLabel} ${path} status ${response.status}`,
      );
      facts.responseDocuments += 1;
    } else if ((await response.clone().text()) !== "") {
      throw new Error(
        `openapi_success_document_invalid: ${methodLabel} ${path} status ${response.status} must have an empty body`,
      );
    }
    recordFacts(facts, methodLabel, path, response.status);
  }

  /** @param {HttpExchange} exchange */
  async function assertExchange(exchange) {
    await assertExchangeInternal(exchange, false);
  }

  /** @param {HttpExchange} exchange */
  async function assertInvalidRequestExchange(exchange) {
    let requestDiagnostic;
    try {
      await assertExchangeInternal(exchange, false);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("openapi_request_document_invalid:")
      ) {
        requestDiagnostic = error.message;
      } else {
        throw error;
      }
    }
    if (!requestDiagnostic) {
      throw new Error("openapi_expected_invalid_request: request was valid");
    }
    if (exchange.response.status < 400) {
      throw new Error(
        `openapi_invalid_request_accepted: response status ${exchange.response.status}`,
      );
    }
    await assertExchangeInternal(exchange, true);
    return requestDiagnostic;
  }

  return {
    assertExchange,
    assertInvalidRequestExchange,
    facts: () => ({
      canonicalErrors: facts.canonicalErrors,
      exchanges: facts.exchanges,
      operations: facts.operations.size,
      requestDocuments: facts.requestDocuments,
      responseDocuments: facts.responseDocuments,
      statuses: facts.statuses.size,
    }),
  };
}

/**
 * @param {Record<string, any>} document
 * @param {typeof fetch} [fetchImplementation]
 */
export async function createConformingFetch(
  document,
  fetchImplementation = fetch,
) {
  const assertion = await createHttpConformanceAssertion(document);
  /** @param {string | URL | Request} input @param {RequestInit} [init] */
  async function execute(input, init) {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.clone().text();
    const response = await fetchImplementation(request);
    return {
      exchange: {
        request: {
          body,
          headers: request.headers,
          method,
          url: request.url,
        },
        response,
      },
      response,
    };
  }

  /**
   * @param {string | URL | Request} input
   * @param {RequestInit} [init]
   */
  async function conformingFetch(input, init) {
    const { exchange, response } = await execute(input, init);
    await assertion.assertExchange(exchange);
    return response;
  }
  /**
   * @param {string | URL | Request} input
   * @param {RequestInit} [init]
   */
  conformingFetch.invalidRequest = async (input, init) => {
    const { exchange, response } = await execute(input, init);
    await assertion.assertInvalidRequestExchange(exchange);
    return response;
  };
  return conformingFetch;
}

/**
 * @param {Record<string, any>} document
 * @param {unknown} schema
 * @param {Response} response
 * @param {string} owner
 */
async function assertJsonResponse(document, schema, response, owner) {
  const contentType = response.headers.get("content-type");
  if (contentType !== JSON_CONTENT_TYPE) {
    throw new Error(
      `openapi_response_content_type_invalid: ${owner.replace(/^openapi_[^:]+: /, "")} expected ${JSON_CONTENT_TYPE}; received ${String(contentType)}`,
    );
  }
  const body = parseJson(await response.clone().text(), owner);
  const validate = schemaValidator(document, schema);
  if (!validate(body)) {
    const [error] = validate.errors ?? [];
    throw new Error(
      `${owner} ${diagnostic(error?.instancePath, error?.message)}`,
    );
  }
}

/**
 * @param {{
 *   exchanges: number,
 *   operations: Set<string>,
 *   statuses: Set<string>,
 * }} facts
 * @param {string} method
 * @param {string} path
 * @param {number} status
 */
function recordFacts(facts, method, path, status) {
  facts.exchanges += 1;
  facts.operations.add(`${method} ${path}`);
  facts.statuses.add(`${method} ${path} ${status}`);
}
