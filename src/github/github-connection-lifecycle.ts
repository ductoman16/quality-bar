import {
  runConnectionRemoval,
  runConnectionRetirement,
} from "../forge/connection/lifecycle-guards.ts";
import { GitHubConnectionError } from "./github-connection-error.ts";
import { readGitHubConnection } from "./github-connection-read.ts";

function fail(code: string, message: string): never {
  throw new GitHubConnectionError(code, message);
}

function loadConnection(durableCore: any) {
  return durableCore.all(
    "SELECT id, lifecycle FROM github_connections LIMIT 1",
  )[0] as any;
}

const isRetired = (connection: any) => connection.lifecycle === "retired";

function hasActiveDependents(durableCore: any, connection: any) {
  return (
    durableCore.all(
      `SELECT repositories.id FROM github_repositories
       JOIN repositories ON repositories.id = github_repositories.repository_id
       WHERE github_repositories.connection_id = ?
         AND repositories.lifecycle != 'retired'`,
      connection.id,
    ).length > 0
  );
}

function commitRetirement(transaction: any, connection: any) {
  transaction.run(
    `UPDATE github_commit_statuses
     SET publication_status = 'unavailable',
         error_code = 'github_connection_retired',
         error_detail =
           'GitHub commit status publication is unavailable because the GitHub Connection is retired'
     WHERE publication_status = 'waiting'
       AND repository_id IN (
         SELECT repository_id
         FROM github_repositories
         WHERE connection_id = ?
       )`,
    connection.id,
  );
  transaction.run(
    `UPDATE github_feedback_bundles
     SET publication_status = 'unavailable',
         error_code = 'github_connection_retired',
         error_detail =
           'GitHub feedback publication is unavailable because the GitHub Connection is retired'
     WHERE publication_status = 'waiting'
       AND evaluation_id IN (
         SELECT github_automatic_evaluations.evaluation_id
         FROM github_automatic_evaluations
         JOIN github_repositories
           ON github_repositories.repository_id =
                github_automatic_evaluations.repository_id
         WHERE github_repositories.connection_id = ?
       )`,
    connection.id,
  );
  transaction.run(
    `UPDATE github_finding_feedback
     SET publication_status = 'unavailable',
         error_code = 'github_connection_retired',
         error_detail =
           'GitHub inline feedback publication is unavailable because the GitHub Connection is retired'
     WHERE publication_status = 'waiting'
       AND evaluation_id IN (
         SELECT github_automatic_evaluations.evaluation_id
         FROM github_automatic_evaluations
         JOIN github_repositories
           ON github_repositories.repository_id =
                github_automatic_evaluations.repository_id
         WHERE github_repositories.connection_id = ?
       )`,
    connection.id,
  );
  transaction.run(
    `UPDATE github_delivery_attempts
     SET generation = generation + 1,
         next_attempt_at = 0,
         error_code = 'github_connection_retired',
         error_detail =
           'GitHub delivery is unavailable because the GitHub Connection is retired',
         response_status = NULL,
         definitive = 1
     WHERE
       (surface = 'commit_status' AND source_id IN (
         SELECT evaluation_id || ':' || desired_state
         FROM github_commit_statuses
         WHERE publication_status = 'unavailable'
           AND repository_id IN (
             SELECT repository_id FROM github_repositories
             WHERE connection_id = ?
           )
       ))
       OR
       (surface = 'aggregate_feedback' AND source_id IN (
         SELECT github_automatic_evaluations.evaluation_id
         FROM github_automatic_evaluations
         JOIN github_repositories
           ON github_repositories.repository_id =
                github_automatic_evaluations.repository_id
         JOIN github_feedback_bundles
           ON github_feedback_bundles.evaluation_id =
                github_automatic_evaluations.evaluation_id
         WHERE github_repositories.connection_id = ?
           AND github_feedback_bundles.publication_status = 'unavailable'
       ))
       OR
       (surface = 'inline_feedback' AND source_id IN (
         SELECT github_finding_feedback.finding_id
         FROM github_finding_feedback
         JOIN github_automatic_evaluations
           ON github_automatic_evaluations.evaluation_id =
                github_finding_feedback.evaluation_id
         JOIN github_repositories
           ON github_repositories.repository_id =
                github_automatic_evaluations.repository_id
         WHERE github_repositories.connection_id = ?
           AND github_finding_feedback.publication_status = 'unavailable'
       ))`,
    connection.id,
    connection.id,
    connection.id,
  );
  for (const table of [
    "github_waiver_adjudication_followups",
    "github_waiver_decision_followups",
  ]) {
    transaction.run(
      `UPDATE ${table}
       SET publication_status = 'unavailable',
           error_code = 'github_connection_retired',
           error_detail =
             'GitHub waiver follow-up publication is unavailable because the GitHub Connection is retired'
       WHERE publication_status = 'waiting'
         AND waiver_adjudication_id IN (
           SELECT waiver_adjudications.id
           FROM waiver_adjudications
           JOIN github_automatic_evaluations
             ON github_automatic_evaluations.evaluation_id =
                  waiver_adjudications.evaluation_id
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_automatic_evaluations.repository_id
           WHERE github_repositories.connection_id = ?
         )`,
      connection.id,
    );
  }
  transaction.run(
    `UPDATE github_delivery_attempts
     SET generation = generation + 1, next_attempt_at = 0,
         error_code = 'github_connection_retired',
         error_detail =
           'GitHub delivery is unavailable because the GitHub Connection is retired',
         response_status = NULL, definitive = 1
     WHERE connection_id = ? AND source_id GLOB 'waiver-*'`,
    connection.id,
  );
}

export function retireGitHubConnection(durableCore: any, request: unknown) {
  return runConnectionRetirement({
    activeDependentsError: {
      code: "github_connection_repositories_active",
      message:
        "GitHub Connection cannot retire while dependent Repositories are enabled or disabled",
    },
    conflictError: {
      code: "github_connection_lifecycle_conflict",
      message: "GitHub Connection changed during retirement",
    },
    durableCore,
    hasActiveDependents,
    input: request,
    isRetired,
    loadConnection,
    notFoundError: {
      code: "github_connection_not_found",
      message: "GitHub Connection is not configured",
    },
    raise: fail,
    readConnection: () => readGitHubConnection(durableCore),
    requestError: {
      code: "github_connection_lifecycle_request_invalid",
      message: "GitHub Connection lifecycle request must retire the Connection",
    },
    runTransaction: (transaction, connection, { assertSingleChange }) => {
      commitRetirement(transaction, connection);
      const credential = transaction.run(
        "DELETE FROM github_connection_credentials WHERE connection_id = ?",
        connection.id,
      );
      transaction.run(
        "DELETE FROM quality_bar_metadata WHERE key = ?",
        `github_poll_gate:${connection.id}`,
      );
      transaction.run(
        "DELETE FROM github_delivery_provider_gates WHERE connection_id = ?",
        connection.id,
      );
      const retired = transaction.run(
        `UPDATE github_connections
         SET lifecycle = 'retired'
         WHERE id = ? AND lifecycle = 'enabled'
           AND NOT EXISTS (
             SELECT 1
             FROM github_repositories
             JOIN repositories
               ON repositories.id = github_repositories.repository_id
             WHERE github_repositories.connection_id = ?
               AND repositories.lifecycle != 'retired'
           )`,
        connection.id,
        connection.id,
      );
      assertSingleChange(credential);
      assertSingleChange(retired);
    },
  });
}

export function removeNeverUsedGitHubConnection(durableCore: any) {
  runConnectionRemoval<any>({
    conflictError: {
      code: "github_connection_lifecycle_conflict",
      message: "GitHub Connection changed during deletion",
    },
    dependentsError: {
      code: "github_connection_delete_unsupported",
      message: "GitHub Connection with dependent Repositories must be retired",
    },
    durableCore,
    hasAnyDependents: (core, connection) =>
      core.all(
        "SELECT repository_id FROM github_repositories WHERE connection_id = ? LIMIT 1",
        connection.id,
      ).length > 0,
    loadConnection: (core) =>
      core.all("SELECT id FROM github_connections LIMIT 1")[0] as any,
    notFoundError: {
      code: "github_connection_not_found",
      message: "GitHub Connection is not configured",
    },
    raise: fail,
    runTransaction: (transaction, connection) => {
      transaction.run(
        "INSERT INTO quality_bar_metadata (key, value) VALUES ('github_connection_delete', ?)",
        connection.id,
      );
      transaction.run(
        "DELETE FROM github_connection_verifications WHERE connection_id = ?",
        connection.id,
      );
      transaction.run(
        "DELETE FROM github_connection_credentials WHERE connection_id = ?",
        connection.id,
      );
      transaction.run(
        "DELETE FROM quality_bar_metadata WHERE key = ?",
        `github_poll_gate:${connection.id}`,
      );
      transaction.run(
        "DELETE FROM github_delivery_provider_gates WHERE connection_id = ?",
        connection.id,
      );
      transaction.run(
        "DELETE FROM github_connections WHERE id = ?",
        connection.id,
      );
      transaction.run(
        "DELETE FROM quality_bar_metadata WHERE key = 'github_connection_delete'",
      );
    },
  });
}
