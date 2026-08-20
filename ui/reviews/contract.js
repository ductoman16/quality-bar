import { modelCapability, nonempty, record } from "../contract.js";

const criterion = (value) =>
  record(value) &&
  nonempty(value.id) &&
  ["advisory", "blocking"].includes(value.impact) &&
  nonempty(value.instruction);

const version = (value) =>
  record(value) &&
  nonempty(value.id) &&
  Number.isSafeInteger(value.number) &&
  value.number > 0 &&
  (value.applicability_rule === null || nonempty(value.applicability_rule)) &&
  Array.isArray(value.criteria) &&
  value.criteria.length > 0 &&
  value.criteria.every(criterion) &&
  record(value.codex_configuration) &&
  ["model", "reasoning_effort", "service_tier"].every((name) =>
    nonempty(value.codex_configuration[name]),
  );

export const validReview = (value) =>
  record(value) &&
  nonempty(value.id) &&
  nonempty(value.name) &&
  nonempty(value.description) &&
  typeof value.archived === "boolean" &&
  typeof value.deletion_eligible === "boolean" &&
  record(value.assignment) &&
  ["installation_wide", "repository_set"].includes(value.assignment.scope) &&
  (value.assignment.scope === "installation_wide" ||
    (Array.isArray(value.assignment.repository_ids) &&
      value.assignment.repository_ids.every(nonempty))) &&
  version(value.active_version) &&
  Array.isArray(value.versions) &&
  value.versions.length > 0 &&
  value.versions.every(version);

export const validReviewChange = (value) =>
  record(value) &&
  typeof value.changed === "boolean" &&
  validReview(value.review);

export const readReviewCollection = (value) => {
  if (
    !record(value) ||
    !Array.isArray(value.reviews) ||
    !value.reviews.every(validReview)
  ) {
    throw new Error("reviews_document_invalid");
  }
  return value.reviews;
};

export const readModelCatalog = (value) => {
  const models = value?.codex?.catalog?.models;
  if (
    !Array.isArray(models) ||
    !models.length ||
    !models.every(modelCapability)
  ) {
    throw new Error("review_dependencies_invalid");
  }
  return models;
};
