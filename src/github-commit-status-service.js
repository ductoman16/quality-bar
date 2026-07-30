import { githubCommitStatusForEvaluation } from "./github-commit-status.js";
import {
  attemptGitHubDelivery,
  recordGitHubDeliveryHealth,
} from "./github-delivery-service.js";

const PUBLICATION_INTERVAL_MS = 1_000;

/** @param {string} serialized @param {any} fallback @param {number} repositoryId */
function readStatusTarget(serialized, fallback, repositoryId) {
  let target;
  try {
    target = JSON.parse(serialized);
  } catch {
    throw new TypeError("GitHub commit status delivery target is invalid");
  }
  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    ("repository_id" in target && target.repository_id !== repositoryId)
  ) {
    throw new TypeError("GitHub commit status delivery target is invalid");
  }
  return typeof target.description === "string" &&
    typeof target.head === "string" &&
    typeof target.state === "string" &&
    typeof target.target_url === "string"
    ? {
        description: target.description,
        head: target.head,
        state: target.state,
        targetUrl: target.target_url,
      }
    : fallback;
}

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connection: {appId: number, id: string}, encrypted: string) => any},
 *   externalOrigin: string,
 *   now?: () => number,
 *   verifier: {
 *     publishCommitStatus: (...parameters: any[]) => Promise<number>,
 *     reconcileCommitStatus: (...parameters: any[]) => Promise<number | null>
 *   }
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
    typeof verifier?.publishCommitStatus !== "function" ||
    typeof verifier.reconcileCommitStatus !== "function"
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
      const attemptedSources = new Set();
      while (true) {
        const rows = durableCore
          .all(
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
            `,
          )
          .filter(
            (/** @type {any} */ row) =>
              !attemptedSources.has(
                `${row.evaluation_id}:${row.desired_state}`,
              ),
          );
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          attemptedSources.add(`${row.evaluation_id}:${row.desired_state}`);
          const outcome = row.result_outcome ?? "pending";
          const status = githubCommitStatusForEvaluation(outcome);
          if (status.state !== row.desired_state) {
            throw new TypeError(
              "GitHub commit status durable state is invalid",
            );
          }
          const target = new URL("/", origin);
          target.searchParams.set("view", "evaluations");
          target.searchParams.set(
            "evaluation_id",
            /** @type {string} */ (row.evaluation_id),
          );
          const statusTarget = {
            ...status,
            head: row.head_commit,
            targetUrl: target.toString(),
          };
          const credentialIdentity = {
            appId: /** @type {number} */ (row.app_id),
            id: /** @type {string} */ (row.connection_id),
          };
          const credentialInput = {
            app_id: row.app_id,
            app_slug: row.app_slug,
            owner: {
              id: row.principal_id,
              login: row.principal_login,
              type: "User",
            },
          };
          const repository = {
            full_name: /** @type {string} */ (row.name),
            id: /** @type {number} */ (row.forge_repository_id),
          };
          const authentication = () => {
            const credential = cipher.decrypt(
              credentialIdentity,
              /** @type {string} */ (row.encrypted_credential),
            );
            return {
              ...credentialInput,
              client_id: credential.client_id,
              pem: credential.pem,
            };
          };
          await attemptGitHubDelivery(durableCore, {
            connectionId: /** @type {string} */ (row.connection_id),
            create: (deliveryTarget) =>
              verifier.publishCommitStatus(
                authentication(),
                /** @type {number} */ (row.installation_id),
                repository,
                readStatusTarget(deliveryTarget, statusTarget, repository.id),
              ),
            now,
            onDefinitive: (transaction, failure, attemptedAt) => {
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
              );
              recordGitHubDeliveryHealth(
                transaction,
                /** @type {string} */ (row.connection_id),
                attemptedAt,
                failure,
              );
            },
            onSuccess: (transaction, externalId, publishedAt) => {
              if (!Number.isSafeInteger(externalId)) {
                throw new TypeError("GitHub status identity is invalid");
              }
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
              );
            },
            reconcile: (deliveryTarget) =>
              verifier.reconcileCommitStatus(
                authentication(),
                /** @type {number} */ (row.installation_id),
                repository,
                readStatusTarget(deliveryTarget, statusTarget, repository.id),
              ),
            sourceId: `${row.evaluation_id}:${row.desired_state}`,
            surface: "commit_status",
            target: JSON.stringify({
              context: "Quality Bar",
              description: status.description,
              head: row.head_commit,
              repository_id: row.forge_repository_id,
              state: row.desired_state,
              target_url: statusTarget.targetUrl,
            }),
          });
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
