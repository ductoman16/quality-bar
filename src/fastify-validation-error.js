/** @param {import("fastify").FastifyRequest} request @param {Array<{instancePath: string, keyword: string, params?: {missingProperty?: string}}>} validation */
export function canonicalFastifyValidationError(request, validation) {
  const operationId = request.routeOptions.schema?.operationId;
  const missingHeaders = new Set(
    validation
      .filter((diagnostic) => diagnostic.keyword === "required")
      .map((diagnostic) => diagnostic.params?.missingProperty),
  );
  if (
    request.headers.authorization === undefined &&
    missingHeaders.has("origin")
  ) {
    return {
      code: "origin_invalid",
      message: "Browser origin is invalid",
      status: 403,
    };
  }
  if (
    request.headers.authorization === undefined &&
    missingHeaders.has("x-quality-bar-csrf")
  ) {
    return {
      code: "csrf_invalid",
      message: "Browser CSRF token is invalid",
      status: 403,
    };
  }
  const firstPath = validation[0]?.instancePath ?? "";
  if (
    operationId === "createExplicitEvaluation" &&
    /^\/(base|head)\//.test(firstPath)
  ) {
    const selector = firstPath.startsWith("/base/") ? "Base" : "Head";
    return {
      code: "evaluation_selector_invalid",
      message: `${selector} selector is invalid`,
      status: 422,
    };
  }
  if (
    operationId === "setReviewAssignment" &&
    validation.some((diagnostic) =>
      diagnostic.instancePath.startsWith("/repository_ids/"),
    )
  ) {
    return {
      code: "review_assignment_repository_invalid",
      message: "Review Assignment Repository identity must be nonblank",
      status: 422,
    };
  }
  if (operationId === "updateWaiverAdjudicatorConfiguration") {
    const field = ["reasoning_effort", "service_tier", "model"].find((name) =>
      validation.some((diagnostic) => diagnostic.instancePath === `/${name}`),
    );
    const capabilityErrors = {
      model: [
        "codex_model_unsupported",
        "Codex model is not supported by the pinned catalog",
      ],
      reasoning_effort: [
        "codex_reasoning_effort_unsupported",
        "Codex reasoning effort is not supported by the selected model",
      ],
      service_tier: [
        "codex_service_tier_unsupported",
        "Codex service tier is not supported by the selected model",
      ],
    };
    const capabilityError = field
      ? capabilityErrors[/** @type {keyof typeof capabilityErrors} */ (field)]
      : undefined;
    if (capabilityError) {
      return {
        code: capabilityError[0],
        message: capabilityError[1],
        status: 422,
      };
    }
  }
  const semanticField = validation.find((diagnostic) =>
    ["/criteria", "/description", "/name"].some((path) =>
      diagnostic.instancePath.endsWith(path),
    ),
  )?.instancePath;
  if (semanticField?.endsWith("/name")) {
    return {
      code: "review_name_invalid",
      message: "Review name must be nonblank",
      status: 422,
    };
  }
  if (semanticField?.endsWith("/description")) {
    return {
      code: "review_description_invalid",
      message: "Review description must be nonblank",
      status: 422,
    };
  }
  if (semanticField?.endsWith("/criteria")) {
    return {
      code: "review_criteria_invalid",
      message: "Review must contain at least one Criterion",
      status: 422,
    };
  }
  if (
    request.routeOptions.schema?.operationId === "deleteNeverUsedReview" &&
    validation.some(
      (diagnostic) =>
        diagnostic.instancePath === "" && diagnostic.keyword === "type",
    )
  ) {
    return {
      code: "request_malformed",
      message: "Request is malformed",
      status: 400,
    };
  }
  return (
    /** @type {any} */ (request.routeOptions.config)
      ?.canonicalValidationError ?? {
      code: "request_malformed",
      message: "Request is malformed",
      status: 400,
    }
  );
}
