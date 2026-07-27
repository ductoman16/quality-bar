import { randomUUID } from "node:crypto";

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
function fail(code, message) {
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

/** @param {unknown} definition */
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

/** @param {unknown} metadata */
function validateMetadata(metadata) {
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

/** @param {unknown} error */
function conflict(error) {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: reviews\.name/.test(error.message)
  );
}

/**
 * @param {ReviewTransaction} transaction
 * @param {string} reviewId
 */
function readReview(transaction, reviewId) {
  const review = transaction.get(
    `SELECT
       reviews.id,
       reviews.name,
       reviews.description,
       review_assignments.scope,
       review_versions.id AS version_id,
       review_versions.number,
       review_versions.model,
       review_versions.reasoning_effort,
       review_versions.service_tier
     FROM reviews
     JOIN review_assignments ON review_assignments.review_id = reviews.id
     JOIN review_versions ON review_versions.id = reviews.active_version_id
     WHERE reviews.id = ?`,
    reviewId,
  );
  if (!review) {
    fail("review_not_found", "Review was not found");
  }
  const criteria = transaction.all(
    `SELECT
       criteria.id,
       criteria.impact,
       criteria.instruction,
       review_version_criteria.position
     FROM review_version_criteria
     JOIN criteria ON criteria.id = review_version_criteria.criterion_id
     WHERE review_version_criteria.review_version_id = ?
     ORDER BY review_version_criteria.position`,
    review.version_id,
  );
  return {
    active_version: {
      codex_configuration: {
        model: review.model,
        reasoning_effort: review.reasoning_effort,
        service_tier: review.service_tier,
      },
      criteria,
      id: review.version_id,
      number: review.number,
    },
    assignment: { scope: review.scope },
    description: review.description,
    id: review.id,
    name: review.name,
  };
}

/**
 * @typedef {{
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>,
 *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 * }} ReviewTransaction
 */

/**
 * @typedef {{
 *   transaction<Result>(callback: (transaction: ReviewTransaction) => Result): Result
 * }} ReviewDurableCore
 */

/**
 * @param {ReviewDurableCore} durableCore
 * @param {{ createId?: () => string, now?: () => number }} [options]
 */
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
    list() {
      return durableCore.transaction((transaction) =>
        transaction
          .all("SELECT id FROM reviews ORDER BY created_at, id")
          .map((row) => {
            if (!row || typeof row.id !== "string") {
              throw new Error("review_list_invalid");
            }
            return readReview(transaction, row.id);
          }),
      );
    },
    /** @param {unknown} definition */
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
    /**
     * @param {string} reviewId
     * @param {unknown} metadata
     */
    updateMetadata(reviewId, metadata) {
      const validated = validateMetadata(metadata);
      try {
        return durableCore.transaction((transaction) => {
          const result = transaction.run(
            "UPDATE reviews SET name = ?, description = ? WHERE id = ?",
            validated.name,
            validated.description,
            reviewId,
          );
          if (result.changes !== 1) {
            fail("review_not_found", "Review was not found");
          }
          return readReview(transaction, reviewId);
        });
      } catch (error) {
        if (conflict(error)) {
          fail("review_name_conflict", "Review name is already in use");
        }
        throw error;
      }
    },
  };
}

/** @param {unknown} error */
export function createUnavailableReviewService(error) {
  return {
    list() {
      throw error;
    },
    create() {
      throw error;
    },
    updateMetadata() {
      throw error;
    },
  };
}
