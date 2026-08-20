import { count, errorFact, nonempty, record } from "../contract.js";

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
  nonempty(value.id) &&
  nonempty(value.url) &&
  (value.name === null || value.name === undefined || nonempty(value.name)) &&
  (value.web_url === null ||
    value.web_url === undefined ||
    nonempty(value.web_url)) &&
  (value.provider === null ||
    value.provider === undefined ||
    ["github", "forgejo"].includes(value.provider)) &&
  ["enabled", "disabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  errorFact(value.health_error) &&
  nonempty(value.credential_type) &&
  typeof value.deletion_eligible === "boolean" &&
  count(value.assignment_count);

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
    /** @type {any[]} */ (value.verification_history).every((item) =>
      validVerification(item),
    ));

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

/** @param {string} provider @param {any} value */
export const validProviderMutation = (provider, value) =>
  provider === "github"
    ? validGitHubConnection(value)
    : validForgejoConnection(value);
