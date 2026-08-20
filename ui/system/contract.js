import {
  count,
  errorFact,
  modelCapability,
  nonempty,
  nullableString,
  record,
} from "../contract.js";

const timestamp = (value) =>
  value === null ||
  (nonempty(value) && new Date(value).toISOString() === value);
const status = (value, allowed) =>
  record(value) && allowed.includes(value.status);

const execution = (value) =>
  record(value) &&
  nonempty(value.execution_status) &&
  count(value.pre_start_attempt_count) &&
  count(value.retry_cycle) &&
  nonempty(value.retry_state) &&
  record(value.lease) &&
  nonempty(value.lease.status) &&
  nullableString(value.lease.worker_id) &&
  record(value.gate) &&
  nonempty(value.gate.code) &&
  (value.evaluation_id
    ? nonempty(value.evaluation_id)
    : nonempty(value.waiver_adjudication_id));

const failure = (value) =>
  record(value) &&
  timestamp(value.completed_at) &&
  errorFact(value.error) &&
  (nonempty(value.evaluation_id) || nonempty(value.waiver_adjudication_id));

const repository = (value) =>
  record(value) &&
  nonempty(value.repository_id) &&
  Number.isSafeInteger(value.forge_repository_id) &&
  value.forge_repository_id > 0 &&
  nonempty(value.name) &&
  ["enabled", "disabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  errorFact(value.health_error) &&
  ["pending", "complete", "error"].includes(value.baseline_status) &&
  timestamp(value.last_success_at) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.rate_gate_until) &&
  errorFact(value.error) &&
  typeof value.next_attempt_after_correction === "boolean";

const externalIdentity = (provider, value) =>
  record(value) &&
  Number.isSafeInteger(value.principal_id) &&
  value.principal_id > 0 &&
  nonempty(value.principal_login) &&
  (provider === "github"
    ? Number.isSafeInteger(value.app_id) &&
      value.app_id > 0 &&
      nonempty(value.app_slug) &&
      Number.isSafeInteger(value.installation_id) &&
      value.installation_id > 0
    : nonempty(value.base_url) && nonempty(value.reported_version));

const pollingConnection = (value) =>
  record(value) &&
  ["github", "forgejo"].includes(value.provider) &&
  nonempty(value.connection_id) &&
  ["enabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  errorFact(value.health_error) &&
  errorFact(value.error) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.rate_gate_until) &&
  typeof value.next_attempt_after_correction === "boolean" &&
  externalIdentity(value.provider, value.external_identity) &&
  Array.isArray(value.repositories) &&
  value.repositories.every(repository);

const deliverySurface = (value) =>
  record(value) &&
  ["github", "forgejo"].includes(value.provider) &&
  ["commit_status", "aggregate_feedback", "inline_feedback"].includes(
    value.surface,
  ) &&
  [
    "aggregate_only",
    "waiting",
    "retry_scheduled",
    "reconciling",
    "succeeded",
    "unavailable",
  ].includes(value.status) &&
  ["aggregate_only", "waiting", "succeeded", "unavailable"].includes(
    value.publication_status,
  ) &&
  ["evaluation", "adjudication", "decision"].includes(value.owner_kind) &&
  (value.owner_kind === "evaluation"
    ? value.adjudication_id === null && value.decision_id === null
    : value.owner_kind === "adjudication"
      ? nonempty(value.adjudication_id) && value.decision_id === null
      : nonempty(value.adjudication_id) && nonempty(value.decision_id)) &&
  ["repository_id", "connection_id", "evaluation_id", "source_identity"].every(
    (name) => nonempty(value[name]),
  ) &&
  nullableString(value.adjudication_id) &&
  nullableString(value.decision_id) &&
  nullableString(value.finding_id) &&
  nullableString(value.target) &&
  (value.external_id === null ||
    (Number.isSafeInteger(value.external_id) && value.external_id > 0)) &&
  count(value.attempt_count) &&
  timestamp(value.last_attempt_at) &&
  timestamp(value.published_at) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.provider_gate_until) &&
  errorFact(value.provider_gate_error) &&
  errorFact(value.error) &&
  typeof value.definitive === "boolean" &&
  typeof value.reconciliation_required === "boolean";

export const validSystem = (value) =>
  record(value) &&
  Array.isArray(value.execution_providers) &&
  value.execution_providers.length > 0 &&
  value.execution_providers.every(
    (provider) =>
      record(provider) &&
      nonempty(provider.id) &&
      nonempty(provider.name) &&
      ["available", "unavailable"].includes(provider.status) &&
      (provider.error === null ||
        provider.error === undefined ||
        (record(provider.error) &&
          nonempty(provider.error.code) &&
          nonempty(provider.error.message) &&
          nonempty(provider.error.recovery))),
  ) &&
  record(value.codex_execution) &&
  record(value.codex_execution.concurrency) &&
  count(value.codex_execution.concurrency.maximum_running) &&
  count(value.codex_execution.concurrency.running_count) &&
  nonempty(value.codex_execution.concurrency.start_gate) &&
  Array.isArray(value.codex_execution.queue?.rows) &&
  value.codex_execution.queue.rows.every(execution) &&
  Array.isArray(value.codex_execution.running?.rows) &&
  value.codex_execution.running.rows.every(execution) &&
  Array.isArray(value.codex_execution.failures) &&
  value.codex_execution.failures.every(failure) &&
  Array.isArray(value.polling?.connections) &&
  value.polling.connections.every(pollingConnection) &&
  Array.isArray(value.delivery?.surfaces) &&
  value.delivery.surfaces.every(deliverySurface) &&
  Array.isArray(value.codex?.catalog?.models) &&
  value.codex.catalog.models.length > 0 &&
  value.codex.catalog.models.every(modelCapability) &&
  count(value.browser_sessions?.active_count) &&
  nonempty(value.implementer_token?.status) &&
  status(value.durable_core, ["ready"]) &&
  status(value.storage, ["available", "unavailable"]) &&
  status(value.cleanup, ["available", "not_run", "running", "unavailable"]) &&
  status(value.backup, ["current", "empty", "stale", "unavailable"]) &&
  status(value.bootstrap, ["complete", "required"]) &&
  status(value.storage_reserve, ["available", "unavailable"]);

export const validConfiguration = (value) =>
  record(value) &&
  typeof value.configured === "boolean" &&
  (!value.configured ||
    (record(value.configuration) &&
      ["model", "reasoning_effort", "service_tier"].every((name) =>
        nonempty(value.configuration[name]),
      )));

/** @param {any} value */
export const validConfigurationChange = (value) =>
  record(value) &&
  typeof value.changed === "boolean" &&
  validConfiguration({ configured: true, configuration: value.configuration });
