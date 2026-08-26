import { validateCodexConfiguration } from "../codex/codex-capabilities.ts";
import {
  ApplicabilityRuleError,
  compileApplicabilityRule,
} from "../applicability/applicability-rule.ts";

export class ReviewError extends Error {
  name: "ReviewError";
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
  }
}

export function fail(code: string, message: string): never {
  throw new ReviewError(code, message);
}

function isExactObject(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateNonblank(value: unknown, code: string, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(code, message);
  }
  return value;
}

export type ValidatedReviewAssignment =
  | {
      scope: "installation_wide";
    }
  | {
      repository_ids: string[];
      scope: "repository_set";
    };

export function validateAssignmentRequest(
  assignment: unknown,
): ValidatedReviewAssignment {
  if (!assignment || typeof assignment !== "object") {
    fail(
      "review_assignment_malformed",
      "Review Assignment must contain exactly one supported scope",
    );
  }
  if (isExactObject(assignment, ["scope"])) {
    if (assignment.scope !== "installation_wide") {
      fail(
        "review_assignment_malformed",
        "Review Assignment must contain exactly one supported scope",
      );
    }
    return { scope: "installation_wide" };
  }
  if (
    !isExactObject(assignment, ["repository_ids", "scope"]) ||
    assignment.scope !== "repository_set" ||
    !Array.isArray(assignment.repository_ids)
  ) {
    fail(
      "review_assignment_malformed",
      "Review Assignment must contain exactly one supported scope",
    );
  }
  const repositoryIds = assignment.repository_ids.map((repositoryId) =>
    validateNonblank(
      repositoryId,
      "review_assignment_repository_invalid",
      "Review Assignment Repository identity must be nonblank",
    ),
  );
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    fail(
      "review_assignment_repository_duplicate",
      "Review Assignment cannot select the same Repository more than once",
    );
  }
  return {
    repository_ids: repositoryIds.toSorted(),
    scope: "repository_set",
  };
}

function validateCreationAssignment(
  assignment: unknown,
): ValidatedReviewAssignment {
  return validateAssignmentRequest(assignment);
}

function validateCriteria(criteria: unknown) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    fail(
      "review_criteria_invalid",
      "Review must contain at least one Criterion",
    );
  }
  return criteria.map((criterion, index) => {
    if (!isExactObject(criterion, ["impact", "instruction"])) {
      fail("review_criterion_malformed", `Criterion ${index + 1} is malformed`);
    }
    const instruction = validateNonblank(
      criterion.instruction,
      "review_criterion_instruction_invalid",
      `Criterion ${index + 1} instruction must be nonblank`,
    );
    if (
      typeof criterion.impact !== "string" ||
      !["advisory", "blocking"].includes(criterion.impact)
    ) {
      fail(
        "review_criterion_impact_invalid",
        `Criterion ${index + 1} impact must be advisory or blocking`,
      );
    }
    return { impact: criterion.impact, instruction };
  });
}

function validateVersionCriteria(criteria: unknown) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    fail(
      "review_criteria_invalid",
      "Review must contain at least one Criterion",
    );
  }
  const identities = new Set();
  return criteria.map((criterion, index) => {
    const existing = isExactObject(criterion, ["id", "impact", "instruction"]);
    if (!existing && !isExactObject(criterion, ["impact", "instruction"])) {
      fail("review_criterion_malformed", `Criterion ${index + 1} is malformed`);
    }
    let id;
    if (existing) {
      id = validateNonblank(
        criterion.id,
        "review_criterion_identity_invalid",
        `Criterion ${index + 1} identity must be nonblank`,
      );
      if (identities.has(id)) {
        fail(
          "review_criterion_identity_duplicate",
          "Review Version contains a duplicate Criterion identity",
        );
      }
      identities.add(id);
    }
    const instruction = validateNonblank(
      criterion.instruction,
      "review_criterion_instruction_invalid",
      `Criterion ${index + 1} instruction must be nonblank`,
    );
    if (
      typeof criterion.impact !== "string" ||
      !["advisory", "blocking"].includes(criterion.impact)
    ) {
      fail(
        "review_criterion_impact_invalid",
        `Criterion ${index + 1} impact must be advisory or blocking`,
      );
    }
    return {
      ...(id === undefined ? {} : { id }),
      impact: criterion.impact,
      instruction,
      position: index + 1,
    };
  });
}

export function validateDefinition(definition: unknown) {
  const keys = [
    "assignment",
    "codex_configuration",
    "criteria",
    "description",
    "name",
  ];
  if (
    !isExactObject(definition, keys) &&
    !isExactObject(definition, [...keys, "applicability_rule"])
  ) {
    fail(
      "review_request_malformed",
      "Review request contains unsupported or missing fields",
    );
  }
  const applicabilityRule = Object.hasOwn(definition, "applicability_rule")
    ? validateExecutableSnapshot({
        applicability_rule: definition.applicability_rule,
        codex_configuration: definition.codex_configuration,
        criteria: definition.criteria,
      }).applicabilityRule
    : null;
  return {
    applicabilityRule,
    assignment: validateCreationAssignment(definition.assignment),
    codexConfiguration: validateCodexConfiguration(
      definition.codex_configuration,
    ),
    criteria: validateCriteria(definition.criteria),
    description: validateNonblank(
      definition.description,
      "review_description_invalid",
      "Review description must be nonblank",
    ),
    name: validateNonblank(
      definition.name,
      "review_name_invalid",
      "Review name must be nonblank",
    ),
  };
}

export function validateMetadata(metadata: unknown) {
  if (!isExactObject(metadata, ["description", "name"])) {
    fail(
      "review_metadata_request_malformed",
      "Review metadata request contains unsupported or missing fields",
    );
  }
  return {
    name: validateNonblank(
      metadata.name,
      "review_name_invalid",
      "Review name must be nonblank",
    ),
    description: validateNonblank(
      metadata.description,
      "review_description_invalid",
      "Review description must be nonblank",
    ),
  };
}

export function validateArchivalRequest(request: unknown) {
  if (
    !isExactObject(request, ["archived"]) ||
    typeof request.archived !== "boolean"
  ) {
    fail(
      "review_archival_request_malformed",
      "Review archival request must contain only an exact archived state",
    );
  }
  return { archived: request.archived };
}

export function validateDeletionRequest(request: unknown) {
  if (!isExactObject(request, [])) {
    fail(
      "review_deletion_request_malformed",
      "Review deletion request must be an empty object",
    );
  }
  return {};
}

export function validateReviewListState(state: unknown) {
  if (state === undefined) {
    return "active";
  }
  if (state !== "active" && state !== "archived") {
    fail(
      "review_list_state_invalid",
      "Review collection state must be active or archived",
    );
  }
  return state;
}

export function validateReactivationRequest(request: unknown) {
  if (!isExactObject(request, ["review_version_id"])) {
    fail(
      "review_version_reactivation_request_malformed",
      "Review Version reactivation request must contain only an exact Review Version identity",
    );
  }
  return {
    reviewVersionId: validateNonblank(
      request.review_version_id,
      "review_version_reactivation_request_malformed",
      "Review Version reactivation request must contain only an exact Review Version identity",
    ),
  };
}

export function validateExecutableSnapshot(snapshot: unknown) {
  if (
    !isExactObject(snapshot, [
      "applicability_rule",
      "codex_configuration",
      "criteria",
    ])
  ) {
    fail(
      "review_version_request_malformed",
      "Review Version request contains unsupported or missing fields",
    );
  }
  if (
    snapshot.applicability_rule !== null &&
    typeof snapshot.applicability_rule !== "string"
  ) {
    fail(
      "review_applicability_rule_malformed",
      "Applicability Rule must be a string or null",
    );
  }
  if (typeof snapshot.applicability_rule === "string") {
    try {
      compileApplicabilityRule(snapshot.applicability_rule);
    } catch (error) {
      if (error instanceof ApplicabilityRuleError) {
        fail(error.code, error.message);
      }
      throw error;
    }
  }
  return {
    applicabilityRule: snapshot.applicability_rule,
    codexConfiguration: validateCodexConfiguration(
      snapshot.codex_configuration,
    ),
    criteria: validateVersionCriteria(snapshot.criteria),
  };
}
