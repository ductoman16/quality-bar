import { exact, nonempty, record } from "../contract.js";
import {
  validCodexConfiguration,
  validModelCatalog,
} from "../system/contract.js";

const criterion = (value) =>
  record(value) &&
  exact(value, ["id", "impact", "instruction", "position"]) &&
  nonempty(value.id) &&
  Number.isSafeInteger(value.position) &&
  value.position > 0 &&
  ["advisory", "blocking"].includes(value.impact) &&
  nonempty(value.instruction);

const version = (value) =>
  record(value) &&
  exact(value, [
    "applicability_rule",
    "codex_configuration",
    "criteria",
    "id",
    "number",
  ]) &&
  nonempty(value.id) &&
  Number.isSafeInteger(value.number) &&
  value.number > 0 &&
  (value.applicability_rule === null || nonempty(value.applicability_rule)) &&
  Array.isArray(value.criteria) &&
  value.criteria.length > 0 &&
  value.criteria.every(criterion) &&
  validCodexConfiguration(value.codex_configuration);

export const matchesReviewVersion = (version, snapshot) =>
  version.applicability_rule === snapshot.applicability_rule &&
  ["model", "reasoning_effort", "service_tier"].every(
    (name) =>
      version.codex_configuration[name] === snapshot.codex_configuration[name],
  ) &&
  version.criteria.length === snapshot.criteria.length &&
  version.criteria.every(
    (item, index) =>
      item.position === index + 1 &&
      item.impact === snapshot.criteria[index].impact &&
      item.instruction === snapshot.criteria[index].instruction &&
      (!snapshot.criteria[index].id || item.id === snapshot.criteria[index].id),
  );
const sameVersion = (left, right) =>
  left.id === right.id &&
  left.number === right.number &&
  matchesReviewVersion(left, right) &&
  left.criteria.every(
    (item, index) => item.position === right.criteria[index].position,
  );

export const validReview = (value) =>
  record(value) &&
  exact(value, [
    "active_version",
    "archived",
    "assignment",
    "deletion_eligible",
    "description",
    "id",
    "name",
    "versions",
  ]) &&
  nonempty(value.id) &&
  nonempty(value.name) &&
  nonempty(value.description) &&
  typeof value.archived === "boolean" &&
  typeof value.deletion_eligible === "boolean" &&
  record(value.assignment) &&
  ["installation_wide", "repository_set"].includes(value.assignment.scope) &&
  (value.assignment.scope === "installation_wide"
    ? exact(value.assignment, ["scope"])
    : exact(value.assignment, ["repository_ids", "scope"]) &&
      Array.isArray(value.assignment.repository_ids) &&
      new Set(value.assignment.repository_ids).size ===
        value.assignment.repository_ids.length &&
      value.assignment.repository_ids.every(nonempty)) &&
  version(value.active_version) &&
  Array.isArray(value.versions) &&
  value.versions.length > 0 &&
  value.versions.every(version) &&
  value.versions.filter(({ id }) => id === value.active_version.id).length ===
    1 &&
  value.versions.some((item) => sameVersion(item, value.active_version));

export const validReviewChange = (value) =>
  record(value) &&
  exact(value, ["changed", "review"]) &&
  typeof value.changed === "boolean" &&
  validReview(value.review);

export const readReviewCollection = (value) => {
  if (
    !record(value) ||
    !exact(value, ["reviews"]) ||
    !Array.isArray(value.reviews) ||
    !value.reviews.every(validReview)
  ) {
    throw new Error("reviews_document_invalid");
  }
  return value.reviews;
};

export const readModelCatalog = (value) => {
  const catalog = value?.codex?.catalog;
  if (!validModelCatalog(catalog)) {
    throw new Error("review_dependencies_invalid");
  }
  return catalog.models;
};
