import { GitHubConnectionError } from "./github-connection-error.js";
import { readGitHubConnection } from "./github-connection-read.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new GitHubConnectionError(code, message);
}

/** @param {any} durableCore @param {unknown} request */
export function retireGitHubConnection(durableCore, request) {
  if (
    !request ||
    Array.isArray(request) ||
    typeof request !== "object" ||
    Object.keys(request).length !== 1 ||
    /** @type {any} */ (request).lifecycle !== "retired"
  ) {
    fail(
      "github_connection_lifecycle_request_invalid",
      "GitHub Connection lifecycle request must retire the Connection",
    );
  }
  const connection = /** @type {any} */ (
    durableCore.all("SELECT id, lifecycle FROM github_connections LIMIT 1")[0]
  );
  if (!connection) {
    fail("github_connection_not_found", "GitHub Connection is not configured");
  }
  if (connection.lifecycle === "retired") {
    return readGitHubConnection(durableCore);
  }
  const dependents = durableCore.all(
    `SELECT repositories.id FROM github_repositories
     JOIN repositories ON repositories.id = github_repositories.repository_id
     WHERE github_repositories.connection_id = ?
       AND repositories.lifecycle != 'retired'`,
    connection.id,
  );
  if (dependents.length) {
    fail(
      "github_connection_repositories_active",
      "GitHub Connection cannot retire while dependent Repositories are enabled or disabled",
    );
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
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
    const credential = transaction.run(
      "DELETE FROM github_connection_credentials WHERE connection_id = ?",
      connection.id,
    );
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = ?",
      `github_poll_gate:${connection.id}`,
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
    if (credential.changes !== 1 || retired.changes !== 1) {
      fail(
        "github_connection_lifecycle_conflict",
        "GitHub Connection changed during retirement",
      );
    }
  });
  return readGitHubConnection(durableCore);
}

/** @param {any} durableCore */
export function removeNeverUsedGitHubConnection(durableCore) {
  const [connection] = durableCore.all(
    "SELECT id FROM github_connections LIMIT 1",
  );
  if (!connection) {
    fail("github_connection_not_found", "GitHub Connection is not configured");
  }
  if (
    durableCore.all(
      "SELECT repository_id FROM github_repositories WHERE connection_id = ? LIMIT 1",
      connection.id,
    ).length
  ) {
    fail(
      "github_connection_delete_unsupported",
      "GitHub Connection with dependent Repositories must be retired",
    );
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
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
      "DELETE FROM github_connections WHERE id = ?",
      connection.id,
    );
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = 'github_connection_delete'",
    );
  });
}
