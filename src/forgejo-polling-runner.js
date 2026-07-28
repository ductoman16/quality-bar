import {
  FORGEJO_POLL_INTERVAL_MS,
  createForgejoPollingService,
  isDefinitiveForgejoPollingFailure,
} from "./forgejo-polling.js";

/** @param {any} durableCore @param {{cipher: any, timestamp: () => number, verifier: any}} dependencies */
export function createForgejoPollingRunner(
  durableCore,
  { cipher, timestamp, verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof timestamp !== "function" ||
    typeof verifier?.listPullRequests !== "function"
  ) {
    throw new TypeError("Forgejo polling runner dependencies are invalid");
  }
  const polling = createForgejoPollingService(durableCore, {
    fetchPullRequests: ({ connection, credential, repository }) =>
      verifier.listPullRequests(
        { baseUrl: connection.base_url, token: credential },
        repository,
      ),
    now: timestamp,
    recordOwningFailure,
  });
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;

  /** @param {any} transaction @param {string} connectionId @param {number[]} forgeRepositoryIds @param {Error & {code: string, repositoryId?: number}} failure @param {number} attemptedAt */
  function recordOwningFailure(
    transaction,
    connectionId,
    forgeRepositoryIds,
    failure,
    attemptedAt,
  ) {
    if (!isDefinitiveForgejoPollingFailure(failure)) {
      return;
    }
    const repositoryFailure = new Set([
      "forgejo_poll_response_invalid",
      "forgejo_repository_api_access_failed",
      "forgejo_repository_permission_denied",
    ]);
    const repositoryId =
      repositoryFailure.has(failure.code) &&
      Number.isSafeInteger(failure.repositoryId) &&
      forgeRepositoryIds.includes(Number(failure.repositoryId))
        ? Number(failure.repositoryId)
        : null;
    if (repositoryId !== null) {
      transaction.run(
        `UPDATE repositories
            SET health = 'error', health_error_code = ?,
                health_error_message = ?, verified_at = ?
          WHERE id = (
            SELECT repository_id FROM forgejo_repositories
             WHERE connection_id = ? AND forge_repository_id = ?
          )`,
        failure.code,
        failure.message,
        attemptedAt,
        connectionId,
        repositoryId,
      );
      return;
    }
    transaction.run(
      "UPDATE forgejo_connections SET health = 'error', verified_at = ? WHERE id = ?",
      attemptedAt,
      connectionId,
    );
  }

  async function runDue() {
    if (running) {
      return;
    }
    running = true;
    try {
      const due = durableCore.all(
        `SELECT forgejo_repository_polls.connection_id,
                forgejo_repository_polls.forge_repository_id,
                forgejo_repository_polls.baseline_status,
                forgejo_connections.base_url,
                forgejo_connection_credentials.encrypted_credential,
                forgejo_repositories.name
           FROM forgejo_repository_polls
           JOIN forgejo_connections
             ON forgejo_connections.id = forgejo_repository_polls.connection_id
           JOIN forgejo_connection_credentials
             ON forgejo_connection_credentials.connection_id = forgejo_connections.id
           JOIN forgejo_repositories
             ON forgejo_repositories.connection_id = forgejo_repository_polls.connection_id
            AND forgejo_repositories.forge_repository_id =
                forgejo_repository_polls.forge_repository_id
           JOIN repositories
             ON repositories.id = forgejo_repositories.repository_id
          WHERE forgejo_repository_polls.next_attempt_at <= ?
            AND forgejo_connections.lifecycle = 'enabled'
            AND forgejo_connections.health = 'healthy'
            AND repositories.lifecycle = 'enabled'
            AND repositories.health = 'healthy'
          ORDER BY forgejo_repository_polls.connection_id,
                   forgejo_repository_polls.forge_repository_id`,
        timestamp(),
      );
      const gatedConnections = new Set();
      for (const row of due) {
        if (gatedConnections.has(row.connection_id)) {
          continue;
        }
        let token;
        try {
          token = cipher.decrypt(row.connection_id, row.encrypted_credential);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          polling.recordFailure({
            connectionId: row.connection_id,
            error: /** @type {Error & {code: string}} */ (error),
            forgeRepositoryId: row.forge_repository_id,
          });
          continue;
        }
        try {
          await polling.reconcile({
            connection: {
              base_url: row.base_url,
              id: row.connection_id,
            },
            credential: token,
            repositories: [
              {
                full_name: row.name,
                id: row.forge_repository_id,
              },
            ],
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "string"
          ) {
            throw error;
          }
          if (
            "nextAttemptAt" in error &&
            Number.isSafeInteger(error.nextAttemptAt)
          ) {
            gatedConnections.add(row.connection_id);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  /**
   * @param {{base_url: string, id: string}} connection
   * @param {string} token
   * @param {{full_name: string, id: number}[]} repositories
   * @param {{recordFailure?: boolean}} [options]
   */
  function prepareBaseline(connection, token, repositories, options) {
    return polling.prepare(
      {
        connection,
        credential: token,
        repositories,
      },
      { baseline: true, recordFailure: options?.recordFailure ?? true },
    );
  }

  return {
    commitBaseline: polling.commitSuccess,
    destroy() {
      if (timer !== null) {
        clearInterval(timer);
      }
    },
    prepareBaseline,
    runDue,
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => void runDue(), FORGEJO_POLL_INTERVAL_MS);
      timer.unref();
      void runDue();
    },
  };
}
