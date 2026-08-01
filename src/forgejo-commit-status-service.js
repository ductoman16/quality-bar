import { forgejoCommitStatusForEvaluation } from "./forgejo-commit-status.js";
import { createIoDutyScheduler } from "./io-execution-pool.js";

const PUBLICATION_INTERVAL_MS = 1_000;

/** @param {unknown} error */
function codedPublicationFailure(error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    throw error;
  }
  return { code: error.code, detail: error.message };
}

/** @param {number} value */
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("now must return a nonnegative safe integer");
  }
  return value;
}

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connectionId: string, encrypted: string) => string},
 *   externalOrigin: string,
 *   ioPool: {run: (duty: "delivery", operation: () => unknown) => Promise<unknown>},
 *   now?: () => number,
 *   verifier: {
 *     publishCommitStatus: (connection: any, repository: any, status: any) => Promise<number>
 *   }
 * }} dependencies
 */
export function createForgejoCommitStatusService(
  durableCore,
  { cipher, externalOrigin, ioPool, now = () => Date.now(), verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof verifier?.publishCommitStatus !== "function"
  ) {
    throw new TypeError("Forgejo commit status dependencies are invalid");
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError("Forgejo commit status requires an HTTP origin");
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
      const rows = durableCore.all(
        `SELECT
           forgejo_commit_statuses.evaluation_id,
           forgejo_commit_statuses.repository_id,
           forgejo_commit_statuses.head_commit,
           forgejo_commit_statuses.desired_state,
           evaluation_results.outcome AS result_outcome,
           forgejo_repositories.forge_repository_id,
           forgejo_repositories.name,
           forgejo_connections.id AS connection_id,
           forgejo_connections.base_url,
           forgejo_connection_credentials.encrypted_credential
         FROM forgejo_commit_statuses
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id =
                forgejo_commit_statuses.repository_id
         JOIN forgejo_connections
           ON forgejo_connections.id = forgejo_repositories.connection_id
         JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id =
                forgejo_connections.id
         LEFT JOIN evaluation_results
           ON evaluation_results.evaluation_id =
                forgejo_commit_statuses.evaluation_id
         WHERE forgejo_commit_statuses.publication_status = 'waiting'
         ORDER BY forgejo_commit_statuses.repository_id,
                  forgejo_commit_statuses.head_commit`,
      );
      for (const row of rows) {
        const outcome = row.result_outcome ?? "pending";
        const status = forgejoCommitStatusForEvaluation(outcome);
        if (status.state !== row.desired_state) {
          throw new TypeError("Forgejo commit status durable state is invalid");
        }
        const target = new URL("/", origin);
        target.searchParams.set("view", "evaluations");
        target.searchParams.set(
          "evaluation_id",
          /** @type {string} */ (row.evaluation_id),
        );
        const repository = {
          full_name: /** @type {string} */ (row.name),
          id: /** @type {number} */ (row.forge_repository_id),
        };
        try {
          const token = cipher.decrypt(
            /** @type {string} */ (row.connection_id),
            /** @type {string} */ (row.encrypted_credential),
          );
          const externalId = await verifier.publishCommitStatus(
            {
              base_url: /** @type {string} */ (row.base_url),
              token,
            },
            repository,
            {
              description: status.description,
              head: /** @type {string} */ (row.head_commit),
              state: status.state,
              targetUrl: target.toString(),
            },
          );
          const publishedAt = timestamp(now());
          if (!Number.isSafeInteger(externalId) || externalId <= 0) {
            throw new TypeError("Forgejo status identity is invalid");
          }
          durableCore.transaction((/** @type {any} */ transaction) => {
            transaction.run(
              `UPDATE forgejo_commit_statuses
               SET publication_status = 'succeeded',
                   published_state = desired_state,
                   published_at = ?,
                   external_id = ?,
                   error_code = NULL,
                   error_detail = NULL
               WHERE repository_id = ?
                 AND head_commit = ?
                 AND evaluation_id = ?
                 AND desired_state = ?
                 AND publication_status = 'waiting'`,
              publishedAt,
              externalId,
              row.repository_id,
              row.head_commit,
              row.evaluation_id,
              row.desired_state,
            );
          });
        } catch (error) {
          const failure = codedPublicationFailure(error);
          durableCore.transaction((/** @type {any} */ transaction) => {
            transaction.run(
              `UPDATE forgejo_commit_statuses
               SET publication_status = 'unavailable',
                   published_state = NULL,
                   published_at = NULL,
                   external_id = NULL,
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
          });
        }
      }
    } finally {
      running = false;
    }
  }

  const schedulePublication = createIoDutyScheduler(
    ioPool,
    "delivery",
    publishWaiting,
  );
  return {
    destroy() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      schedulePublication.cancel();
    },
    publishWaiting,
    start() {
      if (timer) {
        return;
      }
      schedulePublication.background();
      timer = setInterval(
        schedulePublication.background,
        PUBLICATION_INTERVAL_MS,
      );
      timer.unref?.();
    },
  };
}
