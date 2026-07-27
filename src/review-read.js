import { fail } from "./review-validation.js";

/**
 * @typedef {{
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>
 * }} ReviewReadTransaction
 */

/**
 * @param {ReviewReadTransaction} transaction
 * @param {Record<string, import("node:sqlite").SQLInputValue>} version
 */
function readVersion(transaction, version) {
  if (
    typeof version.id !== "string" ||
    typeof version.number !== "number" ||
    !Number.isSafeInteger(version.number) ||
    typeof version.model !== "string" ||
    typeof version.reasoning_effort !== "string" ||
    typeof version.service_tier !== "string" ||
    !(
      version.applicability_rule === null ||
      typeof version.applicability_rule === "string"
    )
  ) {
    throw new Error("review_version_invalid");
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
      version.id,
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
    codex_configuration: {
      model: version.model,
      reasoning_effort: version.reasoning_effort,
      service_tier: version.service_tier,
    },
    applicability_rule: version.applicability_rule,
    criteria,
    id: version.id,
    number: version.number,
  };
}

/**
 * @param {ReviewReadTransaction} transaction
 * @param {string} reviewId
 */
export function readReview(transaction, reviewId) {
  const review = transaction.get(
    `SELECT
       reviews.id,
       reviews.name,
       reviews.description,
       reviews.active_version_id,
       reviews.archived_at,
       review_assignments.scope
     FROM reviews
     JOIN review_assignments ON review_assignments.review_id = reviews.id
     WHERE reviews.id = ?`,
    reviewId,
  );
  if (!review) {
    fail("review_not_found", "Review was not found");
  }
  const versions = transaction
    .all(
      `SELECT
         id,
         number,
         model,
         reasoning_effort,
         service_tier,
         applicability_rule
       FROM review_versions
       WHERE review_id = ?
       ORDER BY number`,
      reviewId,
    )
    .map((version) => {
      if (!version) {
        throw new Error("review_version_invalid");
      }
      return readVersion(transaction, version);
    });
  const activeVersion = versions.find(
    ({ id }) => id === review.active_version_id,
  );
  if (!activeVersion) {
    throw new Error("review_active_version_invalid");
  }
  return {
    active_version: activeVersion,
    archived: review.archived_at !== null,
    assignment: { scope: review.scope },
    description: review.description,
    id: review.id,
    name: review.name,
    versions,
  };
}
