export const EVALUATION_HTTP_TESTS = [
  "test/evaluation-http-integration.test.js",
  "test/evaluation-machine-http-integration.test.js",
  "test/waiver-batch-http-integration.test.js",
];
export const EVALUATION_UNIT_TESTS = [
  "test/evaluation-machine-authorization.test.js",
  "test/evaluation-result-resource.test.js",
];

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
      "test/applicability-result-openapi-conformance.test.js",
      "test/evaluation-machine-openapi-conformance.test.js",
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
