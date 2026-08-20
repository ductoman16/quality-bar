import {
  count,
  exact,
  nonempty,
  nullableString,
  record,
  timestamp,
  uri,
} from "../contract.js";

const error = (value) =>
  value === null ||
  (record(value) &&
    exact(value, ["code", "detail"]) &&
    nonempty(value.code) &&
    nonempty(value.detail));
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const healthy = (value) =>
  value.health === "healthy"
    ? value.health_error === null
    : value.health === "error" && value.health_error !== null;

const repository = (value) =>
  record(value) &&
  exact(value, [
    "baseline_status",
    "error",
    "forge_repository_id",
    "health",
    "health_error",
    "last_success_at",
    "lifecycle",
    "name",
    "next_attempt_after_correction",
    "next_attempt_at",
    "rate_gate_until",
    "repository_id",
  ]) &&
  nonempty(value.repository_id) &&
  positive(value.forge_repository_id) &&
  nonempty(value.name) &&
  ["enabled", "disabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  error(value.health_error) &&
  healthy(value) &&
  ["pending", "complete", "error"].includes(value.baseline_status) &&
  timestamp(value.last_success_at) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.rate_gate_until) &&
  error(value.error) &&
  typeof value.next_attempt_after_correction === "boolean";

const identity = (provider, value) => {
  if (!record(value)) {
    return false;
  }
  const common =
    positive(value.principal_id) && nonempty(value.principal_login);
  return provider === "github"
    ? exact(value, [
        "app_id",
        "app_slug",
        "installation_id",
        "principal_id",
        "principal_login",
      ]) &&
        common &&
        positive(value.app_id) &&
        nonempty(value.app_slug) &&
        positive(value.installation_id)
    : exact(value, [
        "base_url",
        "principal_id",
        "principal_login",
        "reported_version",
      ]) &&
        common &&
        uri(value.base_url) &&
        nonempty(value.reported_version);
};

const connection = (value) =>
  record(value) &&
  exact(value, [
    "connection_id",
    "error",
    "external_identity",
    "health",
    "health_error",
    "lifecycle",
    "next_attempt_after_correction",
    "next_attempt_at",
    "provider",
    "rate_gate_until",
    "repositories",
  ]) &&
  ["github", "forgejo"].includes(value.provider) &&
  nonempty(value.connection_id) &&
  ["enabled", "retired"].includes(value.lifecycle) &&
  ["healthy", "error"].includes(value.health) &&
  error(value.health_error) &&
  healthy(value) &&
  error(value.error) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.rate_gate_until) &&
  typeof value.next_attempt_after_correction === "boolean" &&
  identity(value.provider, value.external_identity) &&
  Array.isArray(value.repositories) &&
  value.repositories.every(repository);

const surface = (value) =>
  record(value) &&
  exact(value, [
    "adjudication_id",
    "attempt_count",
    "connection_id",
    "decision_id",
    "definitive",
    "error",
    "evaluation_id",
    "external_id",
    "finding_id",
    "last_attempt_at",
    "next_attempt_at",
    "owner_kind",
    "provider",
    "provider_gate_error",
    "provider_gate_until",
    "publication_status",
    "published_at",
    "reconciliation_required",
    "repository_id",
    "source_identity",
    "status",
    "surface",
    "target",
  ]) &&
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
  ["repository_id", "connection_id", "evaluation_id", "source_identity"].every(
    (name) => nonempty(value[name]),
  ) &&
  nullableString(value.adjudication_id) &&
  nullableString(value.decision_id) &&
  nullableString(value.finding_id) &&
  nullableString(value.target) &&
  (value.external_id === null || positive(value.external_id)) &&
  count(value.attempt_count) &&
  timestamp(value.last_attempt_at) &&
  timestamp(value.published_at) &&
  timestamp(value.next_attempt_at) &&
  timestamp(value.provider_gate_until) &&
  error(value.provider_gate_error) &&
  error(value.error) &&
  (value.provider_gate_until === null) ===
    (value.provider_gate_error === null) &&
  typeof value.definitive === "boolean" &&
  typeof value.reconciliation_required === "boolean" &&
  (value.owner_kind === "evaluation"
    ? value.adjudication_id === null && value.decision_id === null
    : value.owner_kind === "adjudication"
      ? nonempty(value.adjudication_id) &&
        value.decision_id === null &&
        value.finding_id === null
      : nonempty(value.adjudication_id) &&
        nonempty(value.decision_id) &&
        nonempty(value.finding_id));

export const validPollingDelivery = (polling, delivery) =>
  record(polling) &&
  exact(polling, ["connections"]) &&
  Array.isArray(polling.connections) &&
  polling.connections.every(connection) &&
  record(delivery) &&
  exact(delivery, ["surfaces"]) &&
  Array.isArray(delivery.surfaces) &&
  delivery.surfaces.every(surface);
