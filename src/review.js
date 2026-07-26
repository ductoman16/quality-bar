import { randomUUID } from "node:crypto";

import { validateCodexConfiguration } from "./codex-capabilities.js";

export class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewError(code, message);
}

function isExactObject(value, keys) {
  return (
    value &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateNonblank(value, code, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(code, message);
  }
  return value;
}

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
    if (!["advisory", "blocking"].includes(criterion.impact)) {
      fail(
        "review_criterion_impact_invalid",
        `Criterion ${index + 1} impact must be advisory or blocking`,
      );
    }
    return { impact: criterion.impact, instruction };
  });
}

function validateDefinition(definition) {
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

function conflict(error) {
  return /UNIQUE constraint failed: reviews\.name/.test(error?.message);
}

export function createReviewService(
  durableCore,
  { createId = randomUUID, now = () => Date.now() } = {},
) {
  if (typeof durableCore?.transaction !== "function") {
    throw new TypeError("durableCore must provide transactions");
  }
  if (typeof createId !== "function" || typeof now !== "function") {
    throw new TypeError("createId and now must be functions");
  }

  return {
    create(definition) {
      const validated = validateDefinition(definition);
      const createdAt = now();
      if (!Number.isSafeInteger(createdAt)) {
        throw new TypeError("now must return a safe integer timestamp");
      }
      const reviewId = createId();
      const versionId = createId();
      const criteria = validated.criteria.map((criterion, index) => ({
        ...criterion,
        id: createId(),
        position: index + 1,
      }));
      if (
        ![reviewId, versionId, ...criteria.map(({ id }) => id)].every(
          (id) => typeof id === "string" && id.length > 0,
        )
      ) {
        throw new TypeError("createId must return nonempty strings");
      }

      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO reviews (id, name, description, active_version_id, created_at) VALUES (?, ?, ?, ?, ?)",
            reviewId,
            validated.name,
            validated.description,
            versionId,
            createdAt,
          );
          transaction.run(
            "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            versionId,
            reviewId,
            1,
            validated.codexConfiguration.model,
            validated.codexConfiguration.reasoning_effort,
            validated.codexConfiguration.service_tier,
            createdAt,
          );
          transaction.run(
            "INSERT INTO review_assignments (review_id, scope, created_at) VALUES (?, ?, ?)",
            reviewId,
            validated.assignment.scope,
            createdAt,
          );
          for (const criterion of criteria) {
            transaction.run(
              "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES (?, ?, ?, ?, ?)",
              criterion.id,
              reviewId,
              criterion.instruction,
              criterion.impact,
              createdAt,
            );
            transaction.run(
              "INSERT INTO review_version_criteria (review_version_id, criterion_id, position) VALUES (?, ?, ?)",
              versionId,
              criterion.id,
              criterion.position,
            );
          }
          transaction.run(
            "UPDATE review_versions SET sealed_at = ? WHERE id = ?",
            createdAt,
            versionId,
          );
        });
      } catch (error) {
        if (conflict(error)) {
          fail("review_name_conflict", "Review name is already in use");
        }
        throw error;
      }

      return {
        active_version: {
          codex_configuration: validated.codexConfiguration,
          criteria,
          id: versionId,
          number: 1,
        },
        assignment: validated.assignment,
        description: validated.description,
        id: reviewId,
        name: validated.name,
      };
    },
  };
}

export function createUnavailableReviewService(error) {
  return {
    create() {
      throw error;
    },
  };
}
