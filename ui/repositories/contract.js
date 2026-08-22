import { count, exact, httpsUrl, nonempty, record, uri } from "../contract.js";

/** @param {any} value */
export const validRepository = (value) =>
  record(value) &&
  exact(value, [
    "credential_type",
    "deletion_eligible",
    "health",
    "health_error",
    "id",
    "lifecycle",
    "url",
    ...(value.credential_type === "forge_connection"
      ? [
          "api_url",
          "assignment_count",
          "forge_connection_id",
          "forge_repository_id",
          "name",
          "provider",
          "verification_id",
          "verified_at",
          "web_url",
        ]
      : []),
  ]) &&
  nonempty(value.id) &&
  httpsUrl(value.url) &&
  ["enabled", "disabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  (value.health === "healthy"
    ? value.health_error === null
    : record(value.health_error) &&
      exact(value.health_error, ["code", "message"]) &&
      nonempty(value.health_error.code) &&
      nonempty(value.health_error.message)) &&
  ["forge_connection", "none", "username_token"].includes(
    value.credential_type,
  ) &&
  typeof value.deletion_eligible === "boolean" &&
  (value.credential_type !== "forge_connection" ||
    (count(value.assignment_count) &&
      uri(value.api_url) &&
      nonempty(value.forge_connection_id) &&
      Number.isSafeInteger(value.forge_repository_id) &&
      value.forge_repository_id > 0 &&
      nonempty(value.name) &&
      ["github", "forgejo"].includes(value.provider) &&
      nonempty(value.verification_id) &&
      count(value.verified_at) &&
      uri(value.web_url)));

/** @param {any} value */
export const validGuidance = (value) => {
  const validReview = (/** @type {any} */ review) =>
    record(review) &&
    exact(review, [
      "active_version",
      "applicability",
      "assignment",
      "criteria",
      "description",
      "id",
      "name",
    ]) &&
    nonempty(review.id) &&
    nonempty(review.name) &&
    nonempty(review.description) &&
    record(review.active_version) &&
    exact(review.active_version, ["id", "number"]) &&
    nonempty(review.active_version.id) &&
    Number.isSafeInteger(review.active_version.number) &&
    review.active_version.number > 0 &&
    record(review.assignment) &&
    exact(review.assignment, ["scope"]) &&
    ["installation_wide", "repository_specific"].includes(
      review.assignment.scope,
    ) &&
    record(review.applicability) &&
    (review.applicability.type === "unconditional"
      ? exact(review.applicability, ["type"])
      : review.applicability.type === "conditional" &&
        exact(review.applicability, ["expression", "profile", "type"]) &&
        nonempty(review.applicability.expression) &&
        review.applicability.profile === "quality-bar-restricted-cel-v1") &&
    Array.isArray(review.criteria) &&
    review.criteria.length > 0 &&
    review.criteria.every(
      (criterion) =>
        record(criterion) &&
        exact(criterion, ["id", "impact", "instruction"]) &&
        nonempty(criterion.id) &&
        ["advisory", "blocking"].includes(criterion.impact) &&
        nonempty(criterion.instruction),
    );
  return (
    record(value) &&
    exact(value, [
      "guidance_revision",
      "repository",
      "reviews",
      "schema_version",
    ]) &&
    value.schema_version === 1 &&
    /^guidance-v1-[A-Za-z0-9_-]{43}$/.test(value.guidance_revision) &&
    record(value.repository) &&
    exact(value.repository, ["id", "url"]) &&
    nonempty(value.repository.id) &&
    httpsUrl(value.repository.url) &&
    Array.isArray(value.reviews) &&
    value.reviews.every(validReview)
  );
};

/** @param {any} value @param {number[]} selected @param {string} requestId */
export const validGitHubSelection = (value, selected, requestId) =>
  Array.isArray(value) &&
  value.length === selected.length &&
  value.every(
    (repository) =>
      validRepository(repository) &&
      repository.provider === "github" &&
      selected.includes(repository.forge_repository_id) &&
      repository.verification_id === requestId,
  ) &&
  new Set(value.map((repository) => repository.forge_repository_id)).size ===
    selected.length;

export {
  forgejoConnectionUsed,
  validForgejoChoices,
  validForgejoConnection,
  validGitHubConnection,
  validLifecycleChange,
  validManifestContinuation,
} from "./provider-contract.js";
