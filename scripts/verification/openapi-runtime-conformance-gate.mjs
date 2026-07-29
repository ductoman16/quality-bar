/**
 * @param {{
 *   ajv: string,
 *   ajvFormats: string,
 *   node: string,
 *   openApiValidator: string,
 * }} tools
 */
export function createOpenApiRuntimeConformanceGate({
  ajv,
  ajvFormats,
  node,
  openApiValidator,
}) {
  return {
    name: "openapi-runtime-conformance",
    testGroup: "shared-http-request-and-response-conformance",
    failureCode: "openapi_runtime_conformance_failed",
    arguments: [
      "--test",
      "test/openapi-conformance.test.js",
      "test/repository-lifecycle-openapi-conformance.test.js",
    ],
    tools: {
      ajv,
      "ajv-formats": ajvFormats,
      node,
      "openapi-schema-validator": openApiValidator,
    },
  };
}
