import { readForgejoPollingFailure } from "../forgejo/forgejo-polling-read.js";
import { readGitHubPollingFailure } from "../github/github-polling-read.js";
import {
  optionalNextAttemptTimestamp,
  optionalTimestamp,
  readError,
  requiredPositiveSafeInteger,
  requiredString,
  requiredUri,
} from "./system-fact-validation.js";
import {
  maxAttemptState,
  maxMillis,
  minMillis,
  nextAttemptState,
  pollingRepository,
  readForgejoConnectionHealthError,
  rejectOrphanedPollingRows,
  validatePollingGateOwnership,
} from "./system-polling-fact-support.js";

/** @param {any} durableCore @param {"github" | "forgejo"} provider */
export function readPollingProvider(durableCore, provider) {
  const github = provider === "github";
  rejectOrphanedPollingRows(durableCore, provider);
  const rows = durableCore.all(
    github
      ? `SELECT connections.id AS connection_id,
                connections.lifecycle AS connection_lifecycle,
                connections.health AS connection_health,
                connections.health_error_code AS connection_health_error_code,
                connections.health_error_message AS connection_health_error_detail,
                connections.app_id, connections.app_slug,
                connections.installation_id, connections.principal_id,
                connections.principal_login,
                repositories.id AS repository_id,
                repositories.lifecycle AS repository_lifecycle,
                repositories.health AS repository_health,
                repositories.health_error_code AS repository_health_error_code,
                repositories.health_error_message AS repository_health_error_detail,
                github_repositories.forge_repository_id,
                github_repositories.name AS repository_name,
                polls.baseline_status,
                polls.last_success_at,
                polls.next_attempt_at,
                polls.rate_gate_until,
                polls.error_code AS polling_error_code,
                polls.error_message AS polling_error_detail,
                polls.snapshot AS polling_snapshot
           FROM github_connections AS connections
           LEFT JOIN github_repositories
             ON github_repositories.connection_id = connections.id
           LEFT JOIN repositories
             ON repositories.id = github_repositories.repository_id
           LEFT JOIN github_repository_polls AS polls
             ON polls.connection_id = github_repositories.connection_id
            AND polls.forge_repository_id = github_repositories.forge_repository_id
          ORDER BY connections.id, github_repositories.forge_repository_id`
      : `SELECT connections.id AS connection_id,
                connections.lifecycle AS connection_lifecycle,
                connections.health AS connection_health,
                connections.verified_at AS connection_verified_at,
                connections.base_url, connections.reported_version,
                connections.principal_id, connections.principal_login,
                repositories.id AS repository_id,
                repositories.lifecycle AS repository_lifecycle,
                repositories.health AS repository_health,
                repositories.health_error_code AS repository_health_error_code,
                repositories.health_error_message AS repository_health_error_detail,
                forgejo_repositories.forge_repository_id,
                forgejo_repositories.name AS repository_name,
                polls.baseline_status,
                polls.last_success_at,
                polls.next_attempt_at,
                polls.rate_gate_until,
                polls.error_code AS polling_error_code,
                polls.error_message AS polling_error_detail,
                polls.snapshot AS polling_snapshot
           FROM forgejo_connections AS connections
           LEFT JOIN forgejo_repositories
             ON forgejo_repositories.connection_id = connections.id
           LEFT JOIN repositories
             ON repositories.id = forgejo_repositories.repository_id
           LEFT JOIN forgejo_repository_polls AS polls
             ON polls.connection_id = forgejo_repositories.connection_id
            AND polls.forge_repository_id = forgejo_repositories.forge_repository_id
          ORDER BY connections.id, forgejo_repositories.forge_repository_id`,
  );
  if (rows.length === 0) {
    validatePollingGateOwnership(durableCore, provider, new Set());
    return [];
  }
  validatePollingGateOwnership(
    durableCore,
    provider,
    new Set(rows.map(/** @param {any} row */ (row) => row.connection_id)),
  );
  /** @type {any[]} */
  const connections = [];
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const row of rows) {
    if (
      typeof row.connection_id !== "string" ||
      row.connection_id.length === 0 ||
      !["enabled", "retired"].includes(row.connection_lifecycle) ||
      !["healthy", "error"].includes(row.connection_health) ||
      !Number.isSafeInteger(row.principal_id) ||
      row.principal_id <= 0 ||
      typeof row.principal_login !== "string" ||
      row.principal_login.length === 0
    ) {
      throw new TypeError(`${provider} System polling connection is invalid`);
    }
    let connection = byId.get(row.connection_id);
    if (!connection) {
      const externalIdentity = github
        ? {
            app_id: requiredPositiveSafeInteger(
              row.app_id,
              "GitHub app identity",
            ),
            app_slug: requiredString(row.app_slug, "GitHub app slug"),
            installation_id: requiredPositiveSafeInteger(
              row.installation_id,
              "GitHub installation identity",
            ),
            principal_id: row.principal_id,
            principal_login: row.principal_login,
          }
        : {
            base_url: requiredUri(row.base_url, "Forgejo base URL"),
            principal_id: row.principal_id,
            principal_login: row.principal_login,
            reported_version: requiredString(
              row.reported_version,
              "Forgejo reported version",
            ),
          };
      connection = {
        connection_id: row.connection_id,
        error: null,
        external_identity: externalIdentity,
        health: row.connection_health,
        health_error: null,
        lifecycle: row.connection_lifecycle,
        next_attempt_at: null,
        provider,
        rate_gate_until: null,
        repositories: [],
        _next_attempt_at_millis: null,
        _next_attempt_after_correction: false,
        _rate_gate_until_millis: null,
        _failure_next_attempt_at_millis: null,
        _failure_next_attempt_after_correction: false,
        _failure_rate_gate_until_millis: null,
        failure_repository_id: null,
      };
      byId.set(row.connection_id, connection);
      connections.push(connection);
    }
    if (row.repository_id === null) {
      if (
        row.forge_repository_id !== null ||
        row.repository_name !== null ||
        row.baseline_status !== null
      ) {
        throw new TypeError(`${provider} System polling repository is partial`);
      }
      continue;
    }
    if (
      row.forge_repository_id === null ||
      row.repository_name === null ||
      row.baseline_status === null
    ) {
      throw new TypeError(`${provider} System polling repository is missing`);
    }
    connection.repositories.push(pollingRepository(row, provider));
  }
  for (const connection of connections) {
    let failureObserved = false;
    const failure = github
      ? readGitHubPollingFailure(durableCore, connection.connection_id)
      : readForgejoPollingFailure(durableCore, connection.connection_id);
    if (failure !== null) {
      failureObserved = true;
      const failureError = readError(
        {
          system_failure_code: failure.error.code,
          system_failure_detail: failure.error.message,
        },
        "system_failure_code",
        "system_failure_detail",
      );
      if (failureError === null) {
        throw new TypeError(`${provider} System polling failure is missing`);
      }
      const failureRepository =
        failure.forge_repository_id === null
          ? null
          : connection.repositories.find(
              /** @param {any} repository */ (repository) =>
                repository.forge_repository_id === failure.forge_repository_id,
            );
      if (
        failure.forge_repository_id !== null &&
        failureRepository === undefined
      ) {
        throw new TypeError(
          `${provider} System polling failure owner is invalid`,
        );
      }
      if (failureRepository === null) {
        connection.error = failureError;
      } else {
        failureRepository.error = failureError;
      }
      const failureAttemptState = maxAttemptState(
        nextAttemptState(failure.next_attempt_at),
        { millis: failure.rate_gate_until, afterCorrection: false },
      );
      connection._failure_next_attempt_at_millis = failureAttemptState.millis;
      connection._failure_next_attempt_after_correction =
        failureAttemptState.afterCorrection;
      connection._failure_rate_gate_until_millis = failure.rate_gate_until;
      connection.failure_repository_id = failure.forge_repository_id;
      if (failure.forge_repository_id === null) {
        connection._next_attempt_at_millis = maxMillis(
          connection._failure_next_attempt_at_millis,
          connection._failure_rate_gate_until_millis,
        );
        connection._next_attempt_after_correction =
          connection._next_attempt_at_millis === null &&
          connection._failure_next_attempt_after_correction;
        connection.next_attempt_at = optionalNextAttemptTimestamp(
          connection._next_attempt_at_millis,
        );
        connection.next_attempt_after_correction =
          connection._next_attempt_after_correction;
        connection._rate_gate_until_millis =
          connection._failure_rate_gate_until_millis;
        connection.rate_gate_until = optionalTimestamp(
          connection._rate_gate_until_millis,
        );
      }
    }
    const connectionRow = rows.find(
      /** @param {any} row */ (row) =>
        row.connection_id === connection.connection_id,
    );
    connection.health_error = github
      ? readError(
          connectionRow,
          "connection_health_error_code",
          "connection_health_error_detail",
        )
      : connection.health === "error"
        ? readForgejoConnectionHealthError(
            durableCore,
            connection.connection_id,
            connectionRow.connection_verified_at,
            failure,
          )
        : null;
    if (
      (connection.health === "healthy" && connection.health_error !== null) ||
      (connection.health === "error" && connection.health_error === null)
    ) {
      throw new TypeError(`${provider} System Connection health is invalid`);
    }
    connection.error = connection.error ?? connection.health_error;
    if (connection.lifecycle !== "enabled" || connection.health !== "healthy") {
      for (const repository of connection.repositories) {
        repository._eligible_for_attempt = false;
        repository._next_attempt_at_millis = null;
        repository._next_attempt_after_correction = false;
        repository.next_attempt_at = null;
        repository.next_attempt_after_correction = false;
      }
    }
    for (const repository of connection.repositories) {
      const failureApplies =
        connection.failure_repository_id === null ||
        connection.failure_repository_id === repository.forge_repository_id;
      if (failureApplies) {
        const nextAttempt = maxAttemptState(
          {
            millis: repository._next_attempt_at_millis,
            afterCorrection: repository._next_attempt_after_correction,
          },
          {
            millis: connection._failure_next_attempt_at_millis,
            afterCorrection: connection._failure_next_attempt_after_correction,
          },
        );
        const gatedAttempt = maxAttemptState(nextAttempt, {
          millis: connection._failure_rate_gate_until_millis,
          afterCorrection: false,
        });
        repository._next_attempt_at_millis = gatedAttempt.millis;
        repository._next_attempt_after_correction =
          gatedAttempt.afterCorrection;
        repository.next_attempt_at = repository._eligible_for_attempt
          ? optionalNextAttemptTimestamp(repository._next_attempt_at_millis)
          : null;
        repository.next_attempt_after_correction =
          repository._eligible_for_attempt &&
          repository._next_attempt_after_correction;
        repository._rate_gate_until_millis = maxMillis(
          repository._rate_gate_until_millis,
          connection._failure_rate_gate_until_millis,
        );
        repository.rate_gate_until = optionalTimestamp(
          repository._rate_gate_until_millis,
        );
      }
    }
    if (
      connection._next_attempt_at_millis === null &&
      (!failureObserved || connection.failure_repository_id !== null)
    ) {
      connection._next_attempt_at_millis = minMillis(
        connection.repositories
          .map(
            /** @param {any} repository */ (repository) =>
              repository._next_attempt_at_millis,
          )
          .filter(
            /** @param {number | null} value */ (value) => value !== null,
          ),
      );
      connection.next_attempt_at = optionalNextAttemptTimestamp(
        connection._next_attempt_at_millis,
      );
      const eligibleRepositories = connection.repositories.filter(
        /** @param {any} repository */ (repository) =>
          repository._eligible_for_attempt,
      );
      connection._next_attempt_after_correction =
        connection._next_attempt_at_millis === null &&
        eligibleRepositories.length > 0 &&
        eligibleRepositories.every(
          /** @param {any} repository */ (repository) =>
            repository._next_attempt_after_correction,
        );
      connection.next_attempt_after_correction =
        connection._next_attempt_after_correction;
    }
    for (const repository of connection.repositories) {
      delete repository._next_attempt_at_millis;
      delete repository._next_attempt_after_correction;
      delete repository._rate_gate_until_millis;
      delete repository._eligible_for_attempt;
    }
    delete connection._next_attempt_at_millis;
    delete connection._next_attempt_after_correction;
    delete connection._rate_gate_until_millis;
    delete connection._failure_next_attempt_at_millis;
    delete connection._failure_next_attempt_after_correction;
    delete connection._failure_rate_gate_until_millis;
    delete connection.failure_next_attempt_at;
    delete connection.failure_rate_gate_until;
    delete connection.failure_repository_id;
    if (connection.lifecycle !== "enabled" || connection.health !== "healthy") {
      connection.next_attempt_at = null;
      connection.next_attempt_after_correction = false;
    }
  }
  return connections;
}
