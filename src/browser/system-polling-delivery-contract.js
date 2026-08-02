"use strict";

const providers = new Set(["github", "forgejo"]);
const baselines = new Set(["pending", "complete", "error"]);
const statuses = new Set([
  "aggregate_only",
  "waiting",
  "retry_scheduled",
  "reconciling",
  "succeeded",
  "unavailable",
]);

/** @param {unknown} value @param {string} name */
function string(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

/** @param {unknown} value */
function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** @param {unknown} value */
function uri(value) {
  if (!nonemptyString(value)) {
    return false;
  }
  try {
    new URL(/** @type {string} */ (value));
    return true;
  } catch {
    return false;
  }
}

/** @type {(value: unknown, name: string) => unknown} */
const nullableString = (value, name) =>
  value === null ? value : string(value, name);

/** @param {unknown} value @param {string} name */
function error(value, name) {
  if (value === null) {
    return null;
  }
  const candidate = /** @type {any} */ (value);
  if (
    !value ||
    typeof value !== "object" ||
    typeof candidate.code !== "string" ||
    candidate.code.trim().length === 0 ||
    typeof candidate.detail !== "string" ||
    candidate.detail.trim().length === 0 ||
    Object.keys(candidate).some((key) => !["code", "detail"].includes(key))
  ) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

/** @param {unknown} value @param {string} name */
function timestamp(value, name) {
  if (value !== null) {
    string(value, name);
    const timestampValue = /** @type {string} */ (value);
    try {
      if (new Date(timestampValue).toISOString() !== timestampValue) {
        throw new Error("not canonical");
      }
    } catch {
      throw new Error(`${name}_invalid`);
    }
  }
  return value;
}

/** @param {string | null} value @param {boolean} afterCorrection @param {boolean} eligible @param {string} name */
function pollingAttempt(value, afterCorrection, eligible, name) {
  timestamp(value, `${name}_next_attempt`);
  if (
    (!eligible && (value !== null || afterCorrection)) ||
    (afterCorrection && value !== null)
  ) {
    throw new Error(`${name}_next_attempt_state_invalid`);
  }
}

/** @param {unknown} value */
function readSystemPollingDeliveryFacts(value) {
  if (!value || typeof value !== "object") {
    throw new Error("system_polling_delivery_facts_invalid");
  }
  const facts = /** @type {any} */ (value);
  if (!facts.polling || !Array.isArray(facts.polling.connections)) {
    throw new Error("system_polling_facts_invalid");
  }
  if (!facts.delivery || !Array.isArray(facts.delivery.surfaces)) {
    throw new Error("system_delivery_facts_invalid");
  }
  for (const connection of facts.polling.connections) {
    const identity = connection?.external_identity;
    const providerIdentityValid =
      connection?.provider === "github"
        ? identity &&
          Number.isSafeInteger(identity.app_id) &&
          identity.app_id > 0 &&
          nonemptyString(identity.app_slug) &&
          Number.isSafeInteger(identity.installation_id) &&
          identity.installation_id > 0
        : identity &&
          uri(identity.base_url) &&
          nonemptyString(identity.reported_version);
    if (
      !connection ||
      typeof connection !== "object" ||
      !providers.has(connection.provider) ||
      typeof connection.connection_id !== "string" ||
      connection.connection_id.length === 0 ||
      !["enabled", "retired"].includes(connection.lifecycle) ||
      !["healthy", "error"].includes(connection.health) ||
      typeof connection.next_attempt_after_correction !== "boolean" ||
      !connection.external_identity ||
      !Number.isSafeInteger(connection.external_identity.principal_id) ||
      connection.external_identity.principal_id <= 0 ||
      !nonemptyString(connection.external_identity.principal_login) ||
      !providerIdentityValid ||
      !Array.isArray(connection.repositories)
    ) {
      throw new Error("system_polling_connection_invalid");
    }
    error(connection.error, "system_polling_connection_error");
    error(connection.health_error, "system_polling_connection_health_error");
    if (
      (connection.health === "healthy" && connection.health_error !== null) ||
      (connection.health === "error" && connection.health_error === null)
    ) {
      throw new Error("system_polling_connection_health_invalid");
    }
    pollingAttempt(
      connection.next_attempt_at,
      connection.next_attempt_after_correction,
      connection.lifecycle === "enabled" && connection.health === "healthy",
      "system_polling_connection",
    );
    timestamp(
      connection.rate_gate_until,
      "system_polling_connection_rate_gate",
    );
    for (const repository of connection.repositories) {
      if (
        !repository ||
        typeof repository !== "object" ||
        typeof repository.repository_id !== "string" ||
        repository.repository_id.length === 0 ||
        !Number.isSafeInteger(repository.forge_repository_id) ||
        repository.forge_repository_id <= 0 ||
        !nonemptyString(repository.name) ||
        !baselines.has(repository.baseline_status) ||
        !["enabled", "disabled", "retired"].includes(repository.lifecycle) ||
        !["healthy", "error"].includes(repository.health) ||
        typeof repository.next_attempt_after_correction !== "boolean"
      ) {
        throw new Error("system_polling_repository_invalid");
      }
      error(repository.error, "system_polling_repository_error");
      error(repository.health_error, "system_polling_repository_health_error");
      if (
        (repository.health === "healthy" && repository.health_error !== null) ||
        (repository.health === "error" && repository.health_error === null)
      ) {
        throw new Error("system_polling_repository_health_invalid");
      }
      timestamp(repository.last_success_at, "system_polling_last_success");
      pollingAttempt(
        repository.next_attempt_at,
        repository.next_attempt_after_correction,
        repository.lifecycle === "enabled" && repository.health === "healthy",
        "system_polling_repository",
      );
      if (
        repository.baseline_status === "complete" &&
        repository.lifecycle === "enabled" &&
        repository.health === "healthy" &&
        repository.next_attempt_at === null &&
        !repository.next_attempt_after_correction
      ) {
        throw new Error("system_polling_repository_next_attempt_invalid");
      }
      timestamp(repository.rate_gate_until, "system_polling_rate_gate");
    }
  }
  for (const surface of facts.delivery.surfaces) {
    if (!surface || typeof surface !== "object") {
      throw new Error("system_delivery_surface_invalid");
    }
    const ownerIdentityValid =
      surface.owner_kind === "evaluation"
        ? surface.adjudication_id === null &&
          surface.decision_id === null &&
          (surface.surface === "inline_feedback"
            ? surface.finding_id !== null
            : surface.finding_id === null)
        : surface.owner_kind === "adjudication"
          ? surface.adjudication_id !== null &&
            surface.decision_id === null &&
            surface.finding_id === null
          : surface.adjudication_id !== null &&
            surface.decision_id !== null &&
            surface.finding_id !== null;
    if (
      !providers.has(surface.provider) ||
      !["commit_status", "aggregate_feedback", "inline_feedback"].includes(
        surface.surface,
      ) ||
      !statuses.has(surface.status) ||
      !["aggregate_only", "waiting", "succeeded", "unavailable"].includes(
        surface.publication_status,
      ) ||
      !["evaluation", "adjudication", "decision"].includes(
        surface.owner_kind,
      ) ||
      typeof surface.repository_id !== "string" ||
      surface.repository_id.length === 0 ||
      typeof surface.connection_id !== "string" ||
      surface.connection_id.length === 0 ||
      typeof surface.evaluation_id !== "string" ||
      surface.evaluation_id.length === 0 ||
      typeof surface.source_identity !== "string" ||
      surface.source_identity.length === 0 ||
      (surface.target !== null &&
        (typeof surface.target !== "string" || surface.target.length === 0)) ||
      !ownerIdentityValid ||
      !Number.isSafeInteger(surface.attempt_count) ||
      surface.attempt_count < 0 ||
      (surface.external_id !== null &&
        (!Number.isSafeInteger(surface.external_id) ||
          surface.external_id <= 0)) ||
      typeof surface.definitive !== "boolean" ||
      typeof surface.reconciliation_required !== "boolean"
    ) {
      throw new Error("system_delivery_surface_invalid");
    }
    nullableString(surface.adjudication_id, "system_delivery_adjudication");
    nullableString(surface.decision_id, "system_delivery_decision");
    nullableString(surface.finding_id, "system_delivery_finding");
    error(surface.error, "system_delivery_error");
    error(surface.provider_gate_error, "system_delivery_provider_gate_error");
    timestamp(surface.last_attempt_at, "system_delivery_last_attempt");
    timestamp(surface.next_attempt_at, "system_delivery_next_attempt");
    timestamp(surface.published_at, "system_delivery_published_at");
    timestamp(surface.provider_gate_until, "system_delivery_provider_gate");
    if (
      (surface.provider_gate_until === null) !==
      (surface.provider_gate_error === null)
    ) {
      throw new Error("system_delivery_provider_gate_invalid");
    }
    if (surface.attempt_count > 0 && surface.last_attempt_at === null) {
      throw new Error("system_delivery_attempt_invalid");
    }
    const validPublicationState =
      (surface.publication_status === "aggregate_only" &&
        surface.status === "aggregate_only" &&
        surface.attempt_count === 0 &&
        surface.target === "aggregate_only" &&
        surface.external_id === null &&
        surface.published_at === null &&
        surface.error === null &&
        surface.next_attempt_at === null &&
        !surface.definitive &&
        !surface.reconciliation_required) ||
      (surface.publication_status === "succeeded" &&
        surface.status === "succeeded" &&
        surface.attempt_count > 0 &&
        surface.last_attempt_at !== null &&
        surface.external_id !== null &&
        surface.published_at !== null &&
        surface.error === null &&
        surface.next_attempt_at === null &&
        !surface.definitive &&
        !surface.reconciliation_required) ||
      (surface.publication_status === "unavailable" &&
        surface.status === "unavailable" &&
        surface.external_id === null &&
        surface.published_at === null &&
        surface.error !== null &&
        surface.next_attempt_at === null &&
        surface.definitive &&
        !surface.reconciliation_required) ||
      (surface.publication_status === "waiting" &&
        ["waiting", "retry_scheduled", "reconciling"].includes(
          surface.status,
        ) &&
        (surface.status === "reconciling"
          ? surface.reconciliation_required
          : !surface.reconciliation_required) &&
        (surface.status !== "retry_scheduled" ||
          surface.next_attempt_at !== null) &&
        surface.external_id === null &&
        surface.published_at === null &&
        !surface.definitive);
    if (!validPublicationState) {
      throw new Error("system_delivery_surface_state_invalid");
    }
  }
  return facts;
}

const systemPollingDeliveryContractWindow = /** @type {any} */ (window);
systemPollingDeliveryContractWindow.systemPollingDeliveryRequireFacts =
  readSystemPollingDeliveryFacts;
