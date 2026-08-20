import {
  count,
  errorFact,
  exact,
  httpsUrl,
  nonempty,
  record,
} from "../contract.js";

/** @param {any} value */
const repositoryChoice = (value) =>
  record(value) &&
  Number.isSafeInteger(value.id) &&
  value.id > 0 &&
  nonempty(value.full_name) &&
  typeof value.private === "boolean";

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
      nonempty(value.api_url) &&
      nonempty(value.forge_connection_id) &&
      Number.isSafeInteger(value.forge_repository_id) &&
      value.forge_repository_id > 0 &&
      nonempty(value.name) &&
      ["github", "forgejo"].includes(value.provider) &&
      nonempty(value.verification_id) &&
      count(value.verified_at) &&
      nonempty(value.web_url)));

/** @param {any} value */
export const validGuidance = (value) =>
  record(value) &&
  Array.isArray(value.reviews) &&
  /** @type {any[]} */ (value.reviews).every(
    (review) =>
      record(review) &&
      nonempty(review.id) &&
      nonempty(review.name) &&
      Array.isArray(review.criteria) &&
      /** @type {any[]} */ (review.criteria).every(
        (criterion) =>
          record(criterion) &&
          nonempty(criterion.id) &&
          ["advisory", "blocking"].includes(criterion.impact) &&
          nonempty(criterion.instruction),
      ),
  );

/** @param {any} value */
const validPrincipal = (value) =>
  record(value) &&
  Number.isSafeInteger(value.id) &&
  value.id > 0 &&
  nonempty(value.login);

/** @param {any} value @param {(value: any) => boolean} [choice] */
const validVerification = (value, choice = repositoryChoice) =>
  record(value) &&
  nonempty(value.id) &&
  nonempty(value.trigger) &&
  Number.isSafeInteger(value.verified_at) &&
  Array.isArray(value.repositories) &&
  value.repositories.every(choice);

/** @param {any} value */
const validGitHubVerification = (value) =>
  validVerification(value) &&
  ["onboarding", "repository_selection", "enablement", "rotation"].includes(
    value.trigger,
  ) &&
  ["success", "error"].includes(value.outcome) &&
  Array.isArray(value.affected_repository_ids) &&
  value.affected_repository_ids.length > 0 &&
  new Set(value.affected_repository_ids).size ===
    value.affected_repository_ids.length &&
  /** @type {any[]} */ (value.affected_repository_ids).every(
    (id) => Number.isSafeInteger(id) && id > 0,
  );

/** @param {any} value */
export const validGitHubConnection = (value) =>
  value === null ||
  (record(value) &&
    nonempty(value.id) &&
    ["enabled", "retired"].includes(value.lifecycle) &&
    ["healthy", "error"].includes(value.health) &&
    errorFact(value.health_error) &&
    validPrincipal(value.principal) &&
    record(value.permissions) &&
    Object.values(value.permissions).every((permission) =>
      nonempty(permission),
    ) &&
    Array.isArray(value.verification_history) &&
    value.verification_history.length > 0 &&
    /** @type {any[]} */ (value.verification_history).every(
      validGitHubVerification,
    ));

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

/** @param {any} value */
const forgejoChoice = (value) =>
  record(value) &&
  Number.isSafeInteger(value.id) &&
  value.id > 0 &&
  nonempty(value.full_name);

/** @param {any} value */
export const validForgejoChoices = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(forgejoChoice);

/** @param {any} value */
export const validForgejoConnection = (value) =>
  value === null ||
  (record(value) &&
    nonempty(value.id) &&
    ["enabled", "retired"].includes(value.lifecycle) &&
    ["healthy", "error"].includes(value.health) &&
    errorFact(value.health_error) &&
    validPrincipal(value.principal) &&
    Array.isArray(value.verification_history) &&
    value.verification_history.length > 0 &&
    /** @type {any[]} */ (value.verification_history).every((item) =>
      validVerification(
        item,
        (repository) =>
          record(repository) &&
          (Number.isSafeInteger(repository.id) ||
            Number.isSafeInteger(repository.forge_repository_id)) &&
          (nonempty(repository.full_name) || nonempty(repository.outcome)),
      ),
    ));

/** @param {any} value */
export const validManifestContinuation = (value) =>
  record(value) &&
  value.method === "POST" &&
  typeof value.state === "string" &&
  /^[A-Za-z0-9_-]{8,256}$/.test(value.state) &&
  value.action ===
    `https://github.com/settings/apps/new?state=${encodeURIComponent(value.state)}` &&
  record(value.manifest) &&
  Object.values(value.manifest).every(
    (item) =>
      typeof item === "string" ||
      typeof item === "boolean" ||
      Array.isArray(item) ||
      record(item),
  );
