/** @param {string} code @param {string} message @param {number} [status] */
const canonicalError = (code, message, status = 422) => ({
  code,
  message,
  status,
});

/** @param {import("fastify").FastifyRequest} request @param {Array<{instancePath: string, keyword: string, params?: {missingProperty?: string}, schemaPath: string}>} validation */
export function canonicalFastifyValidationError(request, validation) {
  const operationId = request.routeOptions.schema?.operationId ?? "";
  const configuredError =
    /** @type {any} */ (request.routeOptions.config)
      ?.canonicalValidationError ??
    canonicalError("request_malformed", "Request is malformed", 400);
  const missingHeaders = new Set(
    validation
      .filter((diagnostic) => diagnostic.keyword === "required")
      .map((diagnostic) => diagnostic.params?.missingProperty),
  );
  if (
    request.headers.authorization === undefined &&
    missingHeaders.has("origin")
  ) {
    return canonicalError("origin_invalid", "Browser origin is invalid", 403);
  }
  if (
    request.headers.authorization === undefined &&
    missingHeaders.has("x-quality-bar-csrf")
  ) {
    return canonicalError("csrf_invalid", "Browser CSRF token is invalid", 403);
  }
  if (
    missingHeaders.has("idempotency-key") ||
    validation.some((diagnostic) =>
      diagnostic.instancePath.endsWith("/idempotency-key"),
    )
  ) {
    return canonicalError(
      "idempotency_key_required",
      "A valid Idempotency-Key header is required",
      400,
    );
  }
  const firstPath = validation[0]?.instancePath ?? "";
  if (
    operationId === "createExplicitEvaluation" &&
    /^\/(base|head)\//.test(firstPath)
  ) {
    const selector = firstPath.startsWith("/base/") ? "Base" : "Head";
    return canonicalError(
      "evaluation_selector_invalid",
      `${selector} selector is invalid`,
    );
  }
  if (
    ["createReview", "setReviewAssignment"].includes(operationId) &&
    validation.some((diagnostic) =>
      diagnostic.instancePath.includes("/repository_ids/"),
    )
  ) {
    return canonicalError(
      "review_assignment_repository_invalid",
      "Review Assignment Repository identity must be nonblank",
    );
  }
  if (
    ["createReview", "setReviewAssignment"].includes(operationId) &&
    validation.some(
      (diagnostic) =>
        diagnostic.keyword === "uniqueItems" &&
        diagnostic.instancePath.endsWith("/repository_ids"),
    )
  ) {
    return canonicalError(
      "review_assignment_repository_duplicate",
      "Review Assignment cannot select the same Repository more than once",
    );
  }
  if (
    operationId === "deleteNeverUsedReview" &&
    validation.some(
      (diagnostic) =>
        diagnostic.instancePath === "" && diagnostic.keyword === "type",
    )
  ) {
    return canonicalError("request_malformed", "Request is malformed", 400);
  }
  if (
    validation.some(
      (diagnostic) =>
        diagnostic.instancePath === "" &&
        ["additionalProperties", "required", "type"].includes(
          diagnostic.keyword,
        ),
    )
  ) {
    return configuredError;
  }
  const codexOperation = [
    "createOnboardingRepositoryReview",
    "createReview",
    "saveOnboardingReviewVersion",
    "saveReviewVersion",
    "updateWaiverAdjudicatorConfiguration",
  ].includes(operationId);
  if (codexOperation) {
    if (
      validation.some(
        (diagnostic) =>
          diagnostic.instancePath === "/codex_configuration" &&
          ["additionalProperties", "required", "type"].includes(
            diagnostic.keyword,
          ),
      )
    ) {
      return canonicalError(
        "codex_configuration_malformed",
        "Codex configuration must contain only exact model, reasoning_effort, and service_tier values",
      );
    }
    const branch = (/** @type {{schemaPath: string}} */ diagnostic) =>
      diagnostic.schemaPath.match(/CodexConfiguration#\/oneOf\/(\d+)\//)?.[1];
    const branches = new Set(validation.map(branch).filter(Boolean));
    const modelBranches = new Set(
      validation
        .filter((diagnostic) => diagnostic.instancePath.endsWith("/model"))
        .map(branch)
        .filter(Boolean),
    );
    const selectedBranch = [...branches].find(
      (candidate) => !modelBranches.has(candidate),
    );
    const field =
      branches.size > 0 && modelBranches.size === branches.size
        ? "model"
        : ["reasoning_effort", "service_tier"].find((name) =>
            validation.some(
              (diagnostic) =>
                diagnostic.instancePath.endsWith(`/${name}`) &&
                branch(diagnostic) === selectedBranch,
            ),
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
      return canonicalError(capabilityError[0], capabilityError[1]);
    }
    if (
      validation.some(
        (diagnostic) =>
          diagnostic.instancePath.includes("codex_configuration") ||
          operationId === "updateWaiverAdjudicatorConfiguration",
      )
    ) {
      return canonicalError(
        "codex_configuration_malformed",
        "Codex configuration must contain only exact model, reasoning_effort, and service_tier values",
      );
    }
  }
  const reviewOperation = [
    "createOnboardingRepositoryReview",
    "createReview",
    "saveOnboardingReviewVersion",
    "saveReviewVersion",
  ].includes(operationId);
  if (reviewOperation) {
    const criterionDiagnostics = validation.filter((diagnostic) =>
      /^\/criteria\/\d+/.test(diagnostic.instancePath),
    );
    const criterionPath =
      criterionDiagnostics[0]?.instancePath.match(/^\/criteria\/\d+/)?.[0];
    const criterionBranch = (/** @type {{schemaPath: string}} */ diagnostic) =>
      diagnostic.schemaPath.match(/^#\/oneOf\/(\d+)\//)?.[1];
    const criterionBranches = new Set(
      criterionDiagnostics.map(criterionBranch).filter(Boolean),
    );
    const malformedBranches = new Set(
      criterionDiagnostics
        .filter(
          (diagnostic) =>
            diagnostic.instancePath === criterionPath &&
            ["additionalProperties", "required", "type"].includes(
              diagnostic.keyword,
            ),
        )
        .map(criterionBranch)
        .filter(Boolean),
    );
    const validBranch = [...criterionBranches].find(
      (candidate) => !malformedBranches.has(candidate),
    );
    const semanticCriterion = ["id", "instruction", "impact"]
      .map((field) =>
        criterionDiagnostics.find(
          (diagnostic) =>
            diagnostic.instancePath.endsWith(`/${field}`) &&
            (validBranch === undefined ||
              criterionBranch(diagnostic) === validBranch),
        ),
      )
      .find(Boolean);
    const criterion =
      criterionBranches.size > 0 && validBranch === undefined
        ? criterionDiagnostics[0]
        : (semanticCriterion ?? criterionDiagnostics[0]);
    if (criterion) {
      const index = Number(criterion.instancePath.split("/")[2]) + 1;
      if (criterion.instancePath.endsWith("/instruction")) {
        return canonicalError(
          "review_criterion_instruction_invalid",
          `Criterion ${index} instruction must be nonblank`,
        );
      }
      if (criterion.instancePath.endsWith("/impact")) {
        return canonicalError(
          "review_criterion_impact_invalid",
          `Criterion ${index} impact must be advisory or blocking`,
        );
      }
      if (criterion.instancePath.endsWith("/id")) {
        return canonicalError(
          "review_criterion_identity_invalid",
          `Criterion ${index} identity must be nonblank`,
        );
      }
      return canonicalError(
        "review_criterion_malformed",
        `Criterion ${index} is malformed`,
      );
    }
    if (
      validation.some(
        (diagnostic) =>
          diagnostic.instancePath === "/applicability_rule" &&
          diagnostic.keyword === "type",
      )
    ) {
      return canonicalError(
        "review_applicability_rule_malformed",
        "Applicability Rule must be a string or null",
      );
    }
  }
  if (
    ["discoverForgejoV16Repositories", "verifyForgejoV16Connection"].includes(
      operationId,
    ) &&
    validation.some(
      (diagnostic) =>
        diagnostic.instancePath === "/base_url" &&
        diagnostic.keyword === "format",
    )
  ) {
    return canonicalError("forgejo_url_invalid", "Forgejo URL is invalid");
  }
  const semanticField = validation.find((diagnostic) =>
    ["/criteria", "/description", "/name"].some((path) =>
      diagnostic.instancePath.endsWith(path),
    ),
  )?.instancePath;
  if (semanticField?.endsWith("/name")) {
    return canonicalError(
      "review_name_invalid",
      "Review name must be nonblank",
    );
  }
  if (semanticField?.endsWith("/description")) {
    return canonicalError(
      "review_description_invalid",
      "Review description must be nonblank",
    );
  }
  if (semanticField?.endsWith("/criteria")) {
    return canonicalError(
      "review_criteria_invalid",
      "Review must contain at least one Criterion",
    );
  }
  return configuredError;
}
