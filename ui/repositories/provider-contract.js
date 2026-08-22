import { count, exact, httpsUrl, nonempty, record, uri } from "../contract.js";

/** @typedef {(value: any) => boolean} Validator */
/** @type {Validator} */
const positive = (value) => Number.isSafeInteger(value) && value > 0;
/** @type {Validator} */
const optionalCount = (value) => value === null || count(value);
/** @type {Validator} */
const codedError = (value) =>
  record(value) &&
  exact(value, ["code", "message"]) &&
  nonempty(value.code) &&
  nonempty(value.message);
/** @type {Validator} */
const health = (value) =>
  value.health === "healthy"
    ? value.health_error === null
    : value.health === "error" && codedError(value.health_error);
/** @type {Validator} */
const permissions = (value) =>
  record(value) &&
  exact(value, ["admin", "pull", "push"]) &&
  value.admin === true &&
  value.pull === true &&
  value.push === true;
/** @type {(value: any, github?: boolean) => boolean} */
const principal = (value, github = false) =>
  record(value) &&
  exact(value, github ? ["id", "login", "type"] : ["id", "login"]) &&
  positive(value.id) &&
  nonempty(value.login) &&
  (!github || value.type === "User");
/** @type {Validator} */
const connectionPrincipal = (value) =>
  record(value) && positive(value.id) && nonempty(value.login);

/** @type {Validator} */
const pollingError = (value) => value === null || codedError(value);
/** @type {(value: any, github: boolean) => boolean} */
const providerPolling = (value, github) =>
  record(value) &&
  exact(value, [
    "baseline_status",
    "error",
    "forge_repository_id",
    "last_success_at",
    "next_attempt_at",
    "rate_gate_until",
  ]) &&
  positive(value.forge_repository_id) &&
  optionalCount(value.last_success_at) &&
  optionalCount(value.next_attempt_at) &&
  optionalCount(value.rate_gate_until) &&
  (value.baseline_status === "pending"
    ? value.error === null &&
      count(value.next_attempt_at) &&
      (!github || value.last_success_at === null)
    : value.baseline_status === "complete"
      ? count(value.last_success_at) && pollingError(value.error)
      : value.baseline_status === "error" && codedError(value.error));
/** @type {Validator} */
const polling = (value) => providerPolling(value, false);
/** @type {Validator} */
const githubPolling = (value) => providerPolling(value, true);
/** @type {Validator} */
const pollingFailure = (value) =>
  value === null ||
  (record(value) &&
    exact(value, [
      "error",
      "forge_repository_id",
      "next_attempt_at",
      "rate_gate_until",
    ]) &&
    codedError(value.error) &&
    (value.forge_repository_id === null ||
      positive(value.forge_repository_id)) &&
    optionalCount(value.next_attempt_at) &&
    optionalCount(value.rate_gate_until));

/** @type {Validator} */
const githubCapabilities = (value) =>
  record(value) &&
  exact(value, [
    "aggregate_feedback",
    "branch_access",
    "commit_status",
    "enumeration",
    "inline_feedback",
    "private_git_read",
    "pull_request_access",
  ]) &&
  Object.values(value).every((item) => item === "verified");
/** @type {Validator} */
const githubPermissions = (value) =>
  record(value) &&
  exact(value, [
    "contents",
    "issues",
    "metadata",
    "pull_requests",
    "statuses",
  ]) &&
  value.contents === "read" &&
  value.metadata === "read" &&
  [value.issues, value.pull_requests, value.statuses].every(
    (item) => item === "write",
  );
/** @type {Validator} */
const githubRepository = (value) =>
  record(value) &&
  exact(value, [
    "api_url",
    "clone_url",
    "full_name",
    "html_url",
    "id",
    "private",
  ]) &&
  positive(value.id) &&
  nonempty(value.full_name) &&
  value.full_name.length >= 3 &&
  httpsUrl(value.api_url) &&
  httpsUrl(value.clone_url) &&
  httpsUrl(value.html_url) &&
  typeof value.private === "boolean";
/** @type {Validator} */
const githubCheck = (value) =>
  record(value) &&
  exact(value, ["outcome", "repository_id"]) &&
  positive(value.repository_id) &&
  ["success", "error", "not_completed"].includes(value.outcome);
/** @type {Validator} */
const githubVerificationError = (value) =>
  record(value) &&
  exact(value, ["code", "message", "repository_id"]) &&
  nonempty(value.code) &&
  nonempty(value.message) &&
  (value.repository_id === null || positive(value.repository_id));
/** @type {Validator} */
const githubVerification = (value) =>
  record(value) &&
  exact(value, [
    "affected_repository_ids",
    "api_profile",
    "capabilities",
    "error",
    "id",
    "outcome",
    "permissions",
    "principal",
    "repositories",
    "repository_checks",
    "trigger",
    "verified_at",
  ]) &&
  nonempty(value.id) &&
  ["onboarding", "repository_selection", "enablement", "rotation"].includes(
    value.trigger,
  ) &&
  count(value.verified_at) &&
  Array.isArray(value.affected_repository_ids) &&
  value.affected_repository_ids.length > 0 &&
  new Set(value.affected_repository_ids).size ===
    value.affected_repository_ids.length &&
  value.affected_repository_ids.every(positive) &&
  Array.isArray(value.repositories) &&
  value.repositories.every(githubRepository) &&
  new Set(
    value.repositories.map((/** @type {any} */ repository) => repository.id),
  ).size === value.repositories.length &&
  value.repositories.every((/** @type {any} */ repository) =>
    value.affected_repository_ids.includes(repository.id),
  ) &&
  Array.isArray(value.repository_checks) &&
  value.repository_checks.length > 0 &&
  value.repository_checks.every(githubCheck) &&
  value.repository_checks.length === value.affected_repository_ids.length &&
  new Set(
    value.repository_checks.map(
      (/** @type {any} */ check) => check.repository_id,
    ),
  ).size === value.repository_checks.length &&
  value.repository_checks.every((/** @type {any} */ check) =>
    value.affected_repository_ids.includes(check.repository_id),
  ) &&
  (value.outcome === "success"
    ? value.api_profile === "github-rest:2026-03-10" &&
      githubCapabilities(value.capabilities) &&
      value.error === null &&
      githubPermissions(value.permissions) &&
      principal(value.principal, true) &&
      value.repositories.length > 0 &&
      value.repository_checks.every(
        (/** @type {any} */ check) => check.outcome === "success",
      )
    : value.outcome === "error" &&
      (value.api_profile === null ||
        value.api_profile === "github-rest:2026-03-10") &&
      (value.capabilities === null || githubCapabilities(value.capabilities)) &&
      githubVerificationError(value.error) &&
      (value.permissions === null || githubPermissions(value.permissions)) &&
      (value.principal === null || principal(value.principal, true)));

export const validGitHubConnection = (/** @type {any} */ value) =>
  value === null ||
  (record(value) &&
    exact(value, [
      "api_profile",
      "app_id",
      "app_slug",
      "capabilities",
      "health",
      "health_error",
      "id",
      "lifecycle",
      "permissions",
      "polling",
      "polling_failure",
      "principal",
      "repository_count",
      "verification_history",
      "verified_at",
    ]) &&
    value.api_profile === "github-rest:2026-03-10" &&
    positive(value.app_id) &&
    nonempty(value.app_slug) &&
    githubCapabilities(value.capabilities) &&
    health(value) &&
    nonempty(value.id) &&
    ["enabled", "retired"].includes(value.lifecycle) &&
    githubPermissions(value.permissions) &&
    Array.isArray(value.polling) &&
    value.polling.every(githubPolling) &&
    pollingFailure(value.polling_failure) &&
    principal(value.principal, true) &&
    positive(value.repository_count) &&
    Array.isArray(value.verification_history) &&
    value.verification_history.length > 0 &&
    value.verification_history.every(githubVerification) &&
    count(value.verified_at));

/** @type {Validator} */
const forgejoRepository = (value) => {
  if (!record(value)) {
    return false;
  }
  if (value.outcome === "success") {
    return (
      exact(value, [
        "api_url",
        "clone_url",
        "full_name",
        "html_url",
        "id",
        "outcome",
        "permissions",
        "private",
      ]) &&
      permissions(value.permissions) &&
      positive(value.id) &&
      nonempty(value.full_name) &&
      uri(value.api_url) &&
      uri(value.clone_url) &&
      uri(value.html_url) &&
      typeof value.private === "boolean"
    );
  }
  const names = [
    ...(value.outcome === "error" ? ["error"] : []),
    "forge_repository_id",
    "outcome",
    ...(value.permissions === undefined ? [] : ["permissions"]),
  ];
  return (
    exact(value, names) &&
    (value.permissions === undefined || permissions(value.permissions)) &&
    positive(value.forge_repository_id) &&
    (value.outcome === "not_completed" ||
      (value.outcome === "error" && codedError(value.error)))
  );
};
/** @type {Validator} */
const forgejoVerification = (value) =>
  record(value) &&
  exact(value, [
    "api_profile",
    "capabilities",
    "error",
    "id",
    "outcome",
    "principal",
    "reported_version",
    "repositories",
    "scopes",
    "trigger",
    "verified_at",
  ]) &&
  nonempty(value.id) &&
  nonempty(value.trigger) &&
  count(value.verified_at) &&
  Array.isArray(value.repositories) &&
  value.repositories.every(forgejoRepository) &&
  (value.outcome !== "success" ||
    value.repositories.every(
      (/** @type {any} */ repository) => repository.outcome === "success",
    )) &&
  (value.outcome === "success"
    ? value.api_profile === "forgejo-v16" &&
      record(value.capabilities) &&
      value.error === null &&
      principal(value.principal) &&
      nonempty(value.reported_version) &&
      /^16\./.test(value.reported_version) &&
      Array.isArray(value.scopes) &&
      value.scopes.every(nonempty)
    : value.outcome === "error" &&
      (value.api_profile === null || value.api_profile === "forgejo-v16") &&
      (value.capabilities === null || record(value.capabilities)) &&
      codedError(value.error) &&
      (value.principal === null || principal(value.principal)) &&
      (value.reported_version === null ||
        (nonempty(value.reported_version) &&
          /^16\./.test(value.reported_version))) &&
      (value.scopes === null ||
        (Array.isArray(value.scopes) && value.scopes.every(nonempty))));

export const validForgejoConnection = (/** @type {any} */ value) =>
  value === null ||
  (record(value) &&
    exact(value, [
      "api_profile",
      "base_url",
      "capabilities",
      "health",
      "health_error",
      "id",
      "lifecycle",
      "polling",
      "polling_failure",
      "principal",
      "reported_version",
      "scopes",
      "verification_history",
      "verified_at",
    ]) &&
    value.api_profile === "forgejo-v16" &&
    uri(value.base_url) &&
    record(value.capabilities) &&
    health(value) &&
    nonempty(value.id) &&
    ["enabled", "retired"].includes(value.lifecycle) &&
    Array.isArray(value.polling) &&
    value.polling.every(polling) &&
    pollingFailure(value.polling_failure) &&
    connectionPrincipal(value.principal) &&
    nonempty(value.reported_version) &&
    /^16\./.test(value.reported_version) &&
    Array.isArray(value.scopes) &&
    value.scopes.every(nonempty) &&
    Array.isArray(value.verification_history) &&
    value.verification_history.length > 0 &&
    value.verification_history.every(forgejoVerification) &&
    count(value.verified_at));

export const validForgejoChoices = (/** @type {any} */ value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (/** @type {any} */ choice) =>
      record(choice) && positive(choice.id) && nonempty(choice.full_name),
  );

export const validManifestContinuation = (/** @type {any} */ value) =>
  record(value) &&
  exact(value, ["action", "manifest", "method", "state"]) &&
  value.method === "POST" &&
  nonempty(value.state) &&
  /^[A-Za-z0-9_-]{8,256}$/.test(value.state) &&
  value.action ===
    `https://github.com/settings/apps/new?state=${encodeURIComponent(value.state)}` &&
  record(value.manifest);

/** @param {string} provider @param {string} method @param {any} value */
export const validLifecycleChange = (provider, method, value) =>
  method === "DELETE"
    ? value === null
    : (provider === "github"
        ? validGitHubConnection(value)
        : validForgejoConnection(value)) && value?.lifecycle === "retired";

/** @param {any} value */
export const forgejoConnectionUsed = (value) =>
  value.verification_history.some(
    (/** @type {any} */ item) => item.repositories.length,
  );
