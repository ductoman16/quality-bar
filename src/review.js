import { randomUUID } from "node:crypto";

import {
  fail,
  ReviewError,
  validateDefinition,
  validateExecutableSnapshot,
  validateMetadata,
} from "./review-validation.js";

export { ReviewError };

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
       review_versions.service_tier,
       review_versions.applicability_rule
     FROM reviews
     JOIN review_assignments ON review_assignments.review_id = reviews.id
     JOIN review_versions ON review_versions.id = reviews.active_version_id
     WHERE reviews.id = ?`,
    reviewId,
  );
  if (!review) {
    fail("review_not_found", "Review was not found");
  }
  const criteria = transaction
    .all(
      `SELECT
         criteria.id,
         review_version_criteria.impact,
         review_version_criteria.instruction,
         review_version_criteria.position
       FROM review_version_criteria
       JOIN criteria ON criteria.id = review_version_criteria.criterion_id
       WHERE review_version_criteria.review_version_id = ?
       ORDER BY review_version_criteria.position`,
      review.version_id,
    )
    .map((criterion) => {
      if (
        !criterion ||
        typeof criterion.id !== "string" ||
        typeof criterion.impact !== "string" ||
        typeof criterion.instruction !== "string" ||
        typeof criterion.position !== "number"
      ) {
        throw new Error("review_version_criteria_invalid");
      }
      return {
        id: criterion.id,
        impact: criterion.impact,
        instruction: criterion.instruction,
        position: criterion.position,
      };
    });
  return {
    active_version: {
      codex_configuration: {
        model: review.model,
        reasoning_effort: review.reasoning_effort,
        service_tier: review.service_tier,
      },
      applicability_rule: review.applicability_rule,
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
            "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, applicability_rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            versionId,
            reviewId,
            1,
            validated.codexConfiguration.model,
            validated.codexConfiguration.reasoning_effort,
            validated.codexConfiguration.service_tier,
            null,
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
              "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES (?, ?, ?, ?, ?)",
              versionId,
              criterion.id,
              criterion.position,
              criterion.instruction,
              criterion.impact,
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
          applicability_rule: null,
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
     * @param {unknown} snapshot
     */
    saveVersion(reviewId, snapshot) {
      const validated = validateExecutableSnapshot(snapshot);
      return durableCore.transaction((transaction) => {
        const current = readReview(transaction, reviewId);
        const identities = new Set(
          transaction
            .all("SELECT id FROM criteria WHERE review_id = ?", reviewId)
            .map((row) => row?.id),
        );
        for (const criterion of validated.criteria) {
          if ("id" in criterion && !identities.has(criterion.id)) {
            fail(
              "review_criterion_not_found",
              "Criterion does not belong to the Review",
            );
          }
        }
        const currentSnapshot = {
          applicabilityRule: current.active_version.applicability_rule,
          codexConfiguration: current.active_version.codex_configuration,
          criteria: current.active_version.criteria,
        };
        if (JSON.stringify(currentSnapshot) === JSON.stringify(validated)) {
          return { changed: false, review: current };
        }

        const createdAt = now();
        if (!Number.isSafeInteger(createdAt)) {
          throw new TypeError("now must return a safe integer timestamp");
        }
        const versionId = createId();
        if (typeof versionId !== "string" || versionId.length === 0) {
          throw new TypeError("createId must return nonempty strings");
        }
        const criteria = validated.criteria.map((criterion) => {
          if (typeof criterion.id === "string") {
            return {
              id: criterion.id,
              impact: criterion.impact,
              instruction: criterion.instruction,
              position: criterion.position,
            };
          }
          const id = createId();
          if (typeof id !== "string" || id.length === 0) {
            throw new TypeError("createId must return nonempty strings");
          }
          return {
            id,
            impact: criterion.impact,
            instruction: criterion.instruction,
            position: criterion.position,
          };
        });
        const nextVersion = transaction.get(
          "SELECT max(number) + 1 AS number FROM review_versions WHERE review_id = ?",
          reviewId,
        )?.number;
        if (
          typeof nextVersion !== "number" ||
          !Number.isSafeInteger(nextVersion)
        ) {
          throw new Error("review_version_number_invalid");
        }
        transaction.run(
          "INSERT INTO review_versions (id, review_id, number, model, reasoning_effort, service_tier, applicability_rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          versionId,
          reviewId,
          nextVersion,
          validated.codexConfiguration.model,
          validated.codexConfiguration.reasoning_effort,
          validated.codexConfiguration.service_tier,
          validated.applicabilityRule,
          createdAt,
        );
        for (const criterion of criteria) {
          if (!identities.has(criterion.id)) {
            transaction.run(
              "INSERT INTO criteria (id, review_id, instruction, impact, created_at) VALUES (?, ?, ?, ?, ?)",
              criterion.id,
              reviewId,
              criterion.instruction,
              criterion.impact,
              createdAt,
            );
          }
          transaction.run(
            "INSERT INTO review_version_criteria (review_version_id, criterion_id, position, instruction, impact) VALUES (?, ?, ?, ?, ?)",
            versionId,
            criterion.id,
            criterion.position,
            criterion.instruction,
            criterion.impact,
          );
        }
        transaction.run(
          "UPDATE review_versions SET sealed_at = ? WHERE id = ?",
          createdAt,
          versionId,
        );
        transaction.run(
          "UPDATE reviews SET active_version_id = ? WHERE id = ?",
          versionId,
          reviewId,
        );
        return { changed: true, review: readReview(transaction, reviewId) };
      });
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
    saveVersion() {
      throw error;
    },
    updateMetadata() {
      throw error;
    },
  };
}
