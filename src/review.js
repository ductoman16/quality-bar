import { randomUUID } from "node:crypto";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import { readReview } from "./review-read.js";
import { selectReviewVersionsForNewEvaluation } from "./review-selection.js";
import {
  fail,
  ReviewError,
  validateArchivalRequest,
  validateDefinition,
  validateExecutableSnapshot,
  validateMetadata,
  validateReactivationRequest,
  validateReviewListState,
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
    /** @param {unknown} [state] */
    list(state) {
      const validatedState = validateReviewListState(state);
      return durableCore.transaction((transaction) =>
        transaction
          .all(
            `SELECT id
             FROM reviews
             WHERE archived_at IS ${validatedState === "active" ? "" : "NOT "}NULL
             ORDER BY created_at, id`,
          )
          .map((row) => {
            if (!row || typeof row.id !== "string") {
              throw new Error("review_list_invalid");
            }
            return readReview(transaction, row.id);
          }),
      );
    },
    selectForNewEvaluation() {
      return durableCore.transaction((transaction) =>
        selectReviewVersionsForNewEvaluation(
          transaction
            .all("SELECT id FROM reviews ORDER BY created_at, id")
            .map((row) => {
              if (!row || typeof row.id !== "string") {
                throw new Error("review_selection_invalid");
              }
              const review = readReview(transaction, row.id);
              if (typeof review.active_version.id !== "string") {
                throw new Error("review_selection_invalid");
              }
              return {
                active_version: { id: review.active_version.id },
                archived: review.archived,
                id: row.id,
              };
            }),
        ),
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
        archived: false,
        assignment: validated.assignment,
        description: validated.description,
        id: reviewId,
        name: validated.name,
        versions: [
          {
            applicability_rule: null,
            codex_configuration: validated.codexConfiguration,
            criteria,
            id: versionId,
            number: 1,
          },
        ],
      };
    },
    /**
     * @param {string} reviewId
     * @param {unknown} request
     */
    reactivateVersion(reviewId, request) {
      const { reviewVersionId } = validateReactivationRequest(request);
      return durableCore.transaction((transaction) => {
        const current = readReview(transaction, reviewId);
        if (current.archived) {
          fail(
            "review_archived",
            "Archived Review cannot reactivate a Review Version",
          );
        }
        const selected = current.versions.find(
          ({ id }) => id === reviewVersionId,
        );
        if (!selected) {
          fail("review_version_not_found", "Review Version was not found");
        }
        validateCodexConfiguration(selected.codex_configuration);
        if (selected.id === current.active_version.id) {
          return { changed: false, review: current };
        }
        const result = transaction.run(
          "UPDATE reviews SET active_version_id = ? WHERE id = ?",
          selected.id,
          reviewId,
        );
        if (result.changes !== 1) {
          throw new Error("review_version_reactivation_failed");
        }
        return { changed: true, review: readReview(transaction, reviewId) };
      });
    },
    /**
     * @param {string} reviewId
     * @param {unknown} snapshot
     */
    saveVersion(reviewId, snapshot) {
      const validated = validateExecutableSnapshot(snapshot);
      return durableCore.transaction((transaction) => {
        const current = readReview(transaction, reviewId);
        if (current.archived) {
          fail(
            "review_archived",
            "Archived Review cannot save a Review Version",
          );
        }
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
              isNew: false,
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
            isNew: true,
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
          if (criterion.isNew) {
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
    /**
     * @param {string} reviewId
     * @param {unknown} request
     */
    setArchived(reviewId, request) {
      const { archived } = validateArchivalRequest(request);
      return durableCore.transaction((transaction) => {
        const current = readReview(transaction, reviewId);
        if (current.archived === archived) {
          return { changed: false, review: current };
        }
        let archivedAt = null;
        if (archived) {
          archivedAt = now();
          if (!Number.isSafeInteger(archivedAt)) {
            throw new TypeError("now must return a safe integer timestamp");
          }
        }
        const result = transaction.run(
          "UPDATE reviews SET archived_at = ? WHERE id = ?",
          archivedAt,
          reviewId,
        );
        if (result.changes !== 1) {
          throw new Error("review_archival_failed");
        }
        return { changed: true, review: readReview(transaction, reviewId) };
      });
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
    reactivateVersion() {
      throw error;
    },
    setArchived() {
      throw error;
    },
    selectForNewEvaluation() {
      throw error;
    },
    updateMetadata() {
      throw error;
    },
  };
}
