import { createHash } from "node:crypto";

import { APPLICABILITY_RULE_PROFILE } from "../applicability/applicability-rule.ts";
import { readReviewCollection } from "../review/review-read-collection.ts";
import { fail } from "../review/review-validation.ts";

const SCHEMA_VERSION = 1;

function nonemptyString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return Number(value);
}

function guidanceReview(review: any) {
  const activeVersion = review?.active_version;
  if (
    !review ||
    review.archived !== false ||
    !activeVersion ||
    !Array.isArray(activeVersion.criteria) ||
    !review.assignment
  ) {
    throw new TypeError("Repository Guidance requires complete active Reviews");
  }
  const assignment =
    review.assignment.scope === "installation_wide"
      ? { scope: "installation_wide" }
      : review.assignment.scope === "repository_set"
        ? { scope: "repository_specific" }
        : null;
  if (!assignment) {
    throw new TypeError("Repository Guidance Review Assignment is invalid");
  }
  const applicability =
    activeVersion.applicability_rule === null
      ? { type: "unconditional" }
      : {
          expression: nonemptyString(
            activeVersion.applicability_rule,
            "Applicability Rule",
          ),
          profile: APPLICABILITY_RULE_PROFILE,
          type: "conditional",
        };
  return {
    active_version: {
      id: nonemptyString(activeVersion.id, "Review Version id"),
      number: positiveInteger(activeVersion.number, "Review Version number"),
    },
    applicability,
    assignment,
    criteria: activeVersion.criteria.map((criterion: any) => ({
      id: nonemptyString(criterion?.id, "Criterion id"),
      impact: nonemptyString(criterion?.impact, "Criterion impact"),
      instruction: nonemptyString(
        criterion?.instruction,
        "Criterion instruction",
      ),
    })),
    description: nonemptyString(review.description, "Review description"),
    id: nonemptyString(review.id, "Review id"),
    name: nonemptyString(review.name, "Review name"),
  };
}

export function buildRepositoryGuidance(
  repository: { id: string; url: string },
  reviews: any[],
) {
  if (!Array.isArray(reviews)) {
    throw new TypeError("Repository Guidance Reviews must be an array");
  }
  const represented = {
    repository: {
      id: nonemptyString(repository?.id, "Repository id"),
      url: nonemptyString(repository?.url, "Repository url"),
    },
    reviews: reviews.map(guidanceReview),
    schema_version: SCHEMA_VERSION,
  };
  const revision = createHash("sha256")
    .update(JSON.stringify(represented))
    .digest("base64url");
  return {
    guidance_revision: `guidance-v1-${revision}`,
    ...represented,
  };
}

export function createRepositoryGuidanceService(durableCore: {
  transaction<Result>(
    callback: (
      transaction: import("../review/review-read-collection.ts").ReviewTransaction,
    ) => Result,
  ): Result;
}) {
  if (typeof durableCore?.transaction !== "function") {
    throw new TypeError("durableCore must provide transactions");
  }
  return {
    read(repositoryId: string) {
      if (typeof repositoryId !== "string" || repositoryId.length === 0) {
        fail("repository_not_found", "Repository was not found");
      }
      return durableCore.transaction((transaction) => {
        const repository = transaction.get(
          "SELECT id, normalized_url FROM repositories WHERE id = ?",
          repositoryId,
        );
        if (
          !repository ||
          typeof repository.id !== "string" ||
          typeof repository.normalized_url !== "string"
        ) {
          fail("repository_not_found", "Repository was not found");
        }
        const reviews = readReviewCollection(
          transaction,
          `SELECT reviews.id
           FROM reviews
           JOIN review_assignments
             ON review_assignments.review_id = reviews.id
           WHERE reviews.archived_at IS NULL
             AND (
               review_assignments.scope = 'installation_wide'
               OR EXISTS (
                 SELECT 1
                 FROM review_assignment_repositories
                 WHERE review_assignment_repositories.review_id = reviews.id
                   AND review_assignment_repositories.repository_id = ?
               )
             )
           ORDER BY reviews.created_at, reviews.id`,
          "repository_guidance_review_invalid",
          repositoryId,
        );
        return buildRepositoryGuidance(
          { id: repository.id, url: repository.normalized_url },
          reviews,
        );
      });
    },
  };
}
