import {
  count,
  exact,
  modelCapability,
  nonempty,
  nullableString,
  record,
  timestamp,
} from "../contract.js";
import { validPollingDelivery } from "./polling-contract.js";
const CATALOG = {
  codex_cli_version: "0.145.0",
  models: ["sol", "terra", "luna"].map((name) => ({
    id: `gpt-5.6-${name}`,
    reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
    service_tiers: ["standard", "fast"],
  })),
};
export const validModelCatalog = (value) =>
  record(value) &&
  exact(value, ["codex_cli_version", "models"]) &&
  value.codex_cli_version === CATALOG.codex_cli_version &&
  Array.isArray(value.models) &&
  value.models.length === CATALOG.models.length &&
  value.models.every((model, index) => {
    const expected = CATALOG.models[index];
    return (
      record(model) &&
      exact(model, ["id", "reasoning_efforts", "service_tiers"]) &&
      model.id === expected.id &&
      JSON.stringify(model.reasoning_efforts) ===
        JSON.stringify(expected.reasoning_efforts) &&
      JSON.stringify(model.service_tiers) ===
        JSON.stringify(expected.service_tiers)
    );
  });
const status = (value, allowed) =>
  record(value) && allowed.includes(value.status);
const storageError = (value) =>
  value === null ||
  (record(value) &&
    exact(value, ["code", "detail"]) &&
    nonempty(value.code) &&
    nonempty(value.detail));
const application = (value) =>
  record(value) &&
  exact(value, [
    "application_version",
    "error",
    "installation_key_identity",
    "schema_version",
    "status",
  ]) &&
  ["available", "unavailable"].includes(value.status) &&
  (value.application_version === null ||
    /^\d+\.\d+\.\d+$/.test(value.application_version)) &&
  storageError(value.error) &&
  (value.status === "unavailable") === (value.error !== null) &&
  (value.installation_key_identity === null ||
    /^sha256:[0-9a-f]{64}$/.test(value.installation_key_identity)) &&
  (value.schema_version === null ||
    (Number.isSafeInteger(value.schema_version) && value.schema_version > 0));
const cleanup = (value) =>
  status(value, ["available", "not_run", "running", "unavailable"]) &&
  exact(value, [
    "artifacts_removed",
    "error",
    "last_run_at",
    "sessions_removed",
    "status",
  ]) &&
  ["artifacts_removed", "sessions_removed"].every(
    (name) => value[name] === null || count(value[name]),
  ) &&
  storageError(value.error) &&
  (value.status === "unavailable") === (value.error !== null) &&
  timestamp(value.last_run_at);
const storage = (value) =>
  status(value, ["available", "unavailable"]) &&
  exact(value, ["cleanup", "filesystems", "reserve_bytes", "status"]) &&
  Number.isSafeInteger(value.reserve_bytes) &&
  value.reserve_bytes > 0 &&
  cleanup(value.cleanup) &&
  Array.isArray(value.filesystems) &&
  value.filesystems.length === 2 &&
  new Set(value.filesystems.map(({ filesystem }) => filesystem)).size === 2 &&
  value.filesystems.every(
    (item) =>
      record(item) &&
      exact(item, ["available_bytes", "filesystem", "path", "status"]) &&
      ["state", "checkouts"].includes(item.filesystem) &&
      ["available", "unavailable"].includes(item.status) &&
      nonempty(item.path) &&
      count(item.available_bytes),
  );
const backupRecord = (value) =>
  record(value) &&
  exact(value, [
    "application_version",
    "created_at",
    "installation_key_identity",
    "kind",
    "schema_version",
  ]) &&
  /^\d+\.\d+\.\d+$/.test(value.application_version) &&
  value.created_at !== null &&
  timestamp(value.created_at) &&
  /^sha256:[0-9a-f]{64}$/.test(value.installation_key_identity) &&
  value.kind === "daily" &&
  Number.isSafeInteger(value.schema_version) &&
  value.schema_version > 0;
const backup = (value) =>
  status(value, ["current", "empty", "stale", "unavailable"]) &&
  exact(value, ["error", "last_successful", "status"]) &&
  storageError(value.error) &&
  (value.status === "unavailable") === (value.error !== null) &&
  (value.last_successful === null || backupRecord(value.last_successful));

const execution = (value) => {
  if (!record(value)) {
    return false;
  }
  const queued = value.execution_status === "queued";
  const evaluation = nonempty(value.evaluation_id);
  return (
    exact(value, [
      "execution_status",
      "gate",
      "lease",
      "pre_start_attempt_count",
      "retry_cycle",
      "retry_error",
      "retry_state",
      ...(queued ? ["next_attempt_at", "queue_position"] : []),
      ...(evaluation
        ? ["evaluation_id", "review_run_id"]
        : ["waiver_adjudication_id"]),
    ]) &&
    ["queued", "running"].includes(value.execution_status) &&
    count(value.pre_start_attempt_count) &&
    Number.isSafeInteger(value.retry_cycle) &&
    value.retry_cycle > 0 &&
    ["ready", "exhausted"].includes(value.retry_state) &&
    storageError(value.retry_error) &&
    record(value.lease) &&
    exact(value.lease, [
      "expires_at",
      "fencing_token",
      "status",
      "worker_id",
    ]) &&
    ["unclaimed", "held", "released", "stuck", "running"].includes(
      value.lease.status,
    ) &&
    timestamp(value.lease.expires_at) &&
    count(value.lease.fencing_token) &&
    nullableString(value.lease.worker_id) &&
    record(value.gate) &&
    exact(value.gate, ["code"]) &&
    nonempty(value.gate.code) &&
    (!queued ||
      (Number.isSafeInteger(value.queue_position) &&
        value.queue_position > 0 &&
        timestamp(value.next_attempt_at))) &&
    (evaluation
      ? nonempty(value.review_run_id)
      : nonempty(value.waiver_adjudication_id))
  );
};

const failure = (value) => {
  const evaluation = nonempty(value?.evaluation_id);
  const waiver = nonempty(value?.waiver_adjudication_id);
  return (
    record(value) &&
    evaluation !== waiver &&
    exact(value, [
      "completed_at",
      "error",
      ...(evaluation ? ["evaluation_id", "review_run_id"] : []),
      ...(waiver ? ["waiver_adjudication_id"] : []),
    ]) &&
    timestamp(value.completed_at) &&
    value.completed_at !== null &&
    value.error !== null &&
    storageError(value.error) &&
    (!evaluation || nonempty(value.review_run_id))
  );
};

export const validSystem = (value) =>
  record(value) &&
  application(value.application) &&
  Array.isArray(value.execution_providers) &&
  value.execution_providers.length > 0 &&
  value.execution_providers.every(
    (provider) =>
      record(provider) &&
      nonempty(provider.id) &&
      nonempty(provider.name) &&
      ["available", "unavailable"].includes(provider.status) &&
      (provider.error === undefined ||
        (record(provider.error) &&
          exact(provider.error, ["code", "message", "recovery"]) &&
          nonempty(provider.error.code) &&
          nonempty(provider.error.message) &&
          nonempty(provider.error.recovery))),
  ) &&
  record(value.codex_execution) &&
  exact(value.codex_execution, [
    "concurrency",
    "failures",
    "queue",
    "running",
  ]) &&
  record(value.codex_execution.concurrency) &&
  exact(value.codex_execution.concurrency, [
    "maximum_running",
    "running_count",
    "start_gate",
  ]) &&
  Number.isSafeInteger(value.codex_execution.concurrency.maximum_running) &&
  value.codex_execution.concurrency.maximum_running >= 1 &&
  value.codex_execution.concurrency.maximum_running <= 4 &&
  count(value.codex_execution.concurrency.running_count) &&
  ["available", "no_new_start"].includes(
    value.codex_execution.concurrency.start_gate,
  ) &&
  Array.isArray(value.codex_execution.queue?.rows) &&
  exact(value.codex_execution.queue, ["count", "rows"]) &&
  value.codex_execution.queue.rows.every(execution) &&
  count(value.codex_execution.queue.count) &&
  value.codex_execution.queue.count ===
    value.codex_execution.queue.rows.length &&
  Array.isArray(value.codex_execution.running?.rows) &&
  exact(value.codex_execution.running, ["count", "rows"]) &&
  value.codex_execution.running.rows.every(execution) &&
  count(value.codex_execution.running.count) &&
  value.codex_execution.running.count ===
    value.codex_execution.running.rows.length &&
  value.codex_execution.concurrency.running_count ===
    value.codex_execution.running.count &&
  Array.isArray(value.codex_execution.failures) &&
  value.codex_execution.failures.every(failure) &&
  validPollingDelivery(value.polling, value.delivery) &&
  Array.isArray(value.codex?.catalog?.models) &&
  ["available", "unavailable"].includes(value.codex.status) &&
  (value.codex.error === undefined || typeof value.codex.error === "string") &&
  nonempty(value.codex.catalog.codex_cli_version) &&
  value.codex.catalog.models.length > 0 &&
  value.codex.catalog.models.every(modelCapability) &&
  validModelCatalog(value.codex.catalog) &&
  value.browser_sessions?.status === "available" &&
  count(value.browser_sessions.active_count) &&
  ["active", "revoked"].includes(value.implementer_token?.status) &&
  value.durable_core?.status === "ready" &&
  nonempty(value.durable_core.database_version) &&
  value.durable_core.foreign_keys === true &&
  value.durable_core.integrity === "ok" &&
  value.durable_core.journal_mode === "wal" &&
  Number.isSafeInteger(value.durable_core.schema_version) &&
  value.durable_core.schema_version > 0 &&
  value.durable_core.synchronous === "full" &&
  storage(value.storage) &&
  backup(value.backup) &&
  status(value.bootstrap, ["complete", "required"]);

export const validConfiguration = (value, models) =>
  record(value) &&
  typeof value.configured === "boolean" &&
  (value.configured
    ? exact(value, ["configuration", "configured"]) &&
      record(value.configuration) &&
      exact(value.configuration, [
        "model",
        "reasoning_effort",
        "service_tier",
      ]) &&
      ["model", "reasoning_effort", "service_tier"].every((name) =>
        nonempty(value.configuration[name]),
      ) &&
      models?.some(
        (model) =>
          model.id === value.configuration.model &&
          model.reasoning_efforts.includes(
            value.configuration.reasoning_effort,
          ) &&
          model.service_tiers.includes(value.configuration.service_tier),
      )
    : exact(value, ["configured"]));

export const validCodexConfiguration = (value) =>
  validConfiguration(
    { configuration: value, configured: true },
    CATALOG.models,
  );

/** @param {any} value */
export const validConfigurationChange = (value, models) =>
  record(value) &&
  exact(value, ["changed", "configuration"]) &&
  typeof value.changed === "boolean" &&
  validConfiguration(
    { configured: true, configuration: value.configuration },
    models,
  );
