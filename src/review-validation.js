import { validateCodexConfiguration } from "./codex-capabilities.js";

export class ReviewError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
export function fail(code, message) {
  throw new ReviewError(code, message);
}

/**
 * @param {unknown} value
 * @param {string[]} keys
 * @returns {value is Record<string, unknown>}
 */
function isExactObject(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {string} message
 */
function validateNonblank(value, code, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(code, message);
  }
  return value;
}

/** @param {unknown} assignment */
function validateAssignment(assignment) {
  if (
    !isExactObject(assignment, ["scope"]) ||
    typeof assignment.scope !== "string"
  ) {
    fail(
      "review_assignment_malformed",
      "Review Assignment must contain only an exact scope",
    );
  }
  if (assignment.scope !== "installation_wide") {
    fail(
      "review_assignment_unsupported",
      "Only an installation-wide Review Assignment is supported",
    );
  }
  return { scope: assignment.scope };
}

/** @param {unknown} criteria */
function validateCriteria(criteria) {
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

/** @param {unknown} criteria */
function validateVersionCriteria(criteria) {
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

/** @param {unknown} definition */
export function validateDefinition(definition) {
  if (
    !isExactObject(definition, [
      "assignment",
      "codex_configuration",
      "criteria",
      "description",
      "name",
    ])
  ) {
    fail(
      "review_request_malformed",
      "Review request contains unsupported or missing fields",
    );
  }
  return {
    assignment: validateAssignment(definition.assignment),
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

/** @param {unknown} metadata */
export function validateMetadata(metadata) {
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

/** @param {unknown} snapshot */
export function validateExecutableSnapshot(snapshot) {
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
  return {
    applicabilityRule: snapshot.applicability_rule,
    codexConfiguration: validateCodexConfiguration(
      snapshot.codex_configuration,
    ),
    criteria: validateVersionCriteria(snapshot.criteria),
  };
}
