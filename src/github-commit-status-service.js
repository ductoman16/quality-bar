import { githubCommitStatusForEvaluation } from "./github-commit-status.js";
import { githubPublicationFailure } from "./github-publication-error.js";

const PUBLICATION_INTERVAL_MS = 1_000;

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connection: {appId: number, id: string}, encrypted: string) => any},
 *   externalOrigin: string,
 *   now?: () => number,
 *   verifier: {publishCommitStatus: (...parameters: any[]) => Promise<void>}
 * }} dependencies
 */
export function createGitHubCommitStatusService(
  durableCore,
  { cipher, externalOrigin, now = () => Date.now(), verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof now !== "function" ||
    typeof verifier?.publishCommitStatus !== "function"
  ) {
    throw new TypeError("GitHub commit status dependencies are invalid");
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError("GitHub commit status requires an HTTP origin");
  }
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      while (true) {
        const [row] = durableCore.all(
          `SELECT
             github_commit_statuses.evaluation_id,
             github_commit_statuses.repository_id,
             github_commit_statuses.head_commit,
             github_commit_statuses.desired_state,
             evaluation_results.outcome AS result_outcome,
             github_repositories.forge_repository_id,
             github_repositories.name,
             github_connections.id AS connection_id,
             github_connections.app_id,
             github_connections.app_slug,
             github_connections.installation_id,
             github_connections.principal_id,
             github_connections.principal_login,
             github_connection_credentials.encrypted_credential
           FROM github_commit_statuses
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_commit_statuses.repository_id
           JOIN github_connections
             ON github_connections.id = github_repositories.connection_id
           JOIN github_connection_credentials
             ON github_connection_credentials.connection_id =
                  github_connections.id
           LEFT JOIN evaluation_results
             ON evaluation_results.evaluation_id =
                  github_commit_statuses.evaluation_id
           WHERE github_commit_statuses.publication_status = 'waiting'
           ORDER BY github_commit_statuses.repository_id,
                    github_commit_statuses.head_commit
           LIMIT 1`,
        );
        if (!row) {
          break;
        }
        const outcome = row.result_outcome ?? "pending";
        const status = githubCommitStatusForEvaluation(outcome);
        if (status.state !== row.desired_state) {
          throw new TypeError("GitHub commit status durable state is invalid");
        }
        const credential = cipher.decrypt(
          {
            appId: /** @type {number} */ (row.app_id),
            id: /** @type {string} */ (row.connection_id),
          },
          /** @type {string} */ (row.encrypted_credential),
        );
        const target = new URL("/", origin);
        target.searchParams.set("view", "evaluations");
        target.searchParams.set(
          "evaluation_id",
          /** @type {string} */ (row.evaluation_id),
        );
        try {
          await verifier.publishCommitStatus(
            {
              app_id: row.app_id,
              app_slug: row.app_slug,
              client_id: credential.client_id,
              owner: {
                id: row.principal_id,
                login: row.principal_login,
                type: "User",
              },
              pem: credential.pem,
            },
            /** @type {number} */ (row.installation_id),
            {
              full_name: /** @type {string} */ (row.name),
              id: /** @type {number} */ (row.forge_repository_id),
            },
            {
              ...status,
              head: row.head_commit,
              targetUrl: target.toString(),
            },
          );
          const publishedAt = now();
          if (!Number.isSafeInteger(publishedAt) || publishedAt < 0) {
            throw new TypeError("now must return a nonnegative safe integer");
          }
          durableCore.transaction((/** @type {any} */ transaction) =>
            transaction.run(
              `UPDATE github_commit_statuses
                  SET publication_status = 'succeeded',
                      published_state = desired_state,
                      published_at = ?,
                      error_code = NULL,
                      error_detail = NULL
                WHERE repository_id = ?
                  AND head_commit = ?
                  AND evaluation_id = ?
                  AND desired_state = ?
                  AND publication_status = 'waiting'`,
              publishedAt,
              row.repository_id,
              row.head_commit,
              row.evaluation_id,
              row.desired_state,
            ),
          );
        } catch (error) {
          const failure = githubPublicationFailure(error);
          durableCore.transaction((/** @type {any} */ transaction) =>
            transaction.run(
              `UPDATE github_commit_statuses
                  SET publication_status = 'unavailable',
                      error_code = ?,
                      error_detail = ?
                WHERE repository_id = ?
                  AND head_commit = ?
                  AND evaluation_id = ?
                  AND desired_state = ?
                  AND publication_status = 'waiting'`,
              failure.code,
              failure.detail,
              row.repository_id,
              row.head_commit,
              row.evaluation_id,
              row.desired_state,
            ),
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    destroy() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    publishWaiting,
    start() {
      if (timer) {
        return;
      }
      void publishWaiting();
      timer = setInterval(() => {
        void publishWaiting();
      }, PUBLICATION_INTERVAL_MS);
      timer.unref?.();
    },
  };
}
