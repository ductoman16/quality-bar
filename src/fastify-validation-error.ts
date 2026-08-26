const ERROR_KEY = "x-quality-bar-error";
const MALFORMED = {
  code: "request_malformed",
  message: "Request is malformed",
  status: 400,
};

function declaredError(
  diagnostics: Array<{
    instancePath: string;
    keyword: string;
    params?: { missingProperty?: string };
    parentSchema?: Record<string, any>;
    schemaPath: string;
  }>,
) {
  for (const diagnostic of diagnostics) {
    const requiredProperty =
      diagnostic.parentSchema?.properties?.[
        diagnostic.params?.missingProperty ?? ""
      ];
    const schema =
      diagnostic.keyword === "required"
        ? diagnostic.parentSchema?.[ERROR_KEY]
          ? diagnostic.parentSchema
          : requiredProperty?.[ERROR_KEY]?.code === "idempotency_key_required"
            ? requiredProperty
            : undefined
        : diagnostic.parentSchema;
    if (schema?.[ERROR_KEY]) {
      const index = Number(diagnostic.instancePath.split("/")[2]) + 1;
      return {
        ...schema[ERROR_KEY],
        message: schema[ERROR_KEY].message.replace("{index}", String(index)),
      };
    }
  }
}

export function canonicalFastifyValidationError(
  request: import("fastify").FastifyRequest,
  diagnostics: Parameters<typeof declaredError>[0],
) {
  const operation = request.routeOptions.schema?.operationId ?? "";
  const configured =
    (request.routeOptions.schema as any)?.[ERROR_KEY] ?? MALFORMED;
  const rootShape = diagnostics.some(
    ({ instancePath, keyword, schemaPath }) =>
      instancePath === "" &&
      !schemaPath.includes("/oneOf/") &&
      ["additionalProperties", "required", "type"].includes(keyword),
  );
  const declared = declaredError(diagnostics);
  if (declared?.code === "idempotency_key_required") {
    return declared;
  }
  if (operation === "deleteNeverUsedReview" && rootShape) {
    return diagnostics.some(({ keyword }) => keyword === "type")
      ? MALFORMED
      : configured;
  }
  if (rootShape) {
    return configured;
  }
  if (
    diagnostics.some(
      ({ instancePath, keyword }) =>
        keyword === "maximum" && instancePath.endsWith("/limit"),
    )
  ) {
    return {
      code: "page_size_invalid",
      message: "Page size is invalid",
      status: 400,
    };
  }
  if (
    operation === "getAnalytics" &&
    !diagnostics.some(({ keyword }) => keyword === "additionalProperties")
  ) {
    return {
      code: "analytics_filter_invalid",
      message: "Analytics filter is invalid",
      status: 400,
    };
  }
  if (operation === "createExplicitEvaluation") {
    const selector = diagnostics.find(({ instancePath }) =>
      /^\/(base|head)\//.test(instancePath),
    )?.instancePath;
    if (selector) {
      const name = selector.startsWith("/base/") ? "Base" : "Head";
      return {
        code: "evaluation_selector_invalid",
        message: `${name} selector is invalid`,
        status: 422,
      };
    }
  }
  return declared ?? configured;
}
