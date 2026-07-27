import { GitHubConnectionError } from "./github-connection-error.js";

/**
 * @param {{durableCore: {all: (sql: string) => any[]}, completeInstallation: (input: {installationId: string, state: string}) => Promise<any>, pending: Map<string, any>, timestamp: () => number, transientToken: () => string}} dependencies
 * @param {unknown} request
 */
export async function reactivateGitHubConnection(
  { durableCore, completeInstallation, pending, timestamp, transientToken },
  request,
) {
  const candidate = /** @type {{pem?: unknown}} */ (request);
  if (
    !request ||
    Array.isArray(request) ||
    typeof request !== "object" ||
    Object.keys(request).length !== 1 ||
    typeof candidate.pem !== "string" ||
    candidate.pem.length === 0
  ) {
    throw new GitHubConnectionError(
      "github_connection_reactivation_request_invalid",
      "GitHub Connection reactivation requires one replacement private key",
    );
  }
  const [connection] = /** @type {any[]} */ (
    durableCore.all(
      `SELECT id, app_id, app_slug, installation_id, principal_id,
              principal_login, lifecycle
       FROM github_connections LIMIT 1`,
    )
  );
  if (!connection) {
    throw new GitHubConnectionError(
      "github_connection_not_found",
      "GitHub Connection is not configured",
    );
  }
  if (connection.lifecycle !== "retired") {
    throw new GitHubConnectionError(
      "github_connection_reactivation_unsupported",
      "GitHub Connection must be retired before reactivation",
    );
  }
  const state = transientToken();
  pending.set(state, {
    createdAt: timestamp(),
    credential: {
      app_id: connection.app_id,
      app_slug: connection.app_slug,
      client_id: null,
      owner: {
        id: connection.principal_id,
        login: connection.principal_login,
        type: "User",
      },
      pem: candidate.pem,
    },
    stage: "installation",
  });
  return completeInstallation({
    installationId: String(connection.installation_id),
    state,
  });
}
