import {
  formatGitHubAggregateFeedback,
  formatGitHubInlineFeedback,
  projectFrozenDiffLineRange,
} from "./github-feedback.js";
import { githubPublicationFailure } from "./github-publication-error.js";
import { readEvaluationFindings } from "./evaluation-result-children.js";

const PUBLICATION_INTERVAL_MS = 1_000;

/** @param {() => number} now */
function publicationTimestamp(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("now must return a nonnegative safe integer");
  }
  return value;
}

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connection: {appId: number, id: string}, encrypted: string) => any},
 *   externalOrigin: string,
 *   now?: () => number,
 *   verifier: {
 *     publishAggregateFeedback: (...parameters: any[]) => Promise<number>,
 *     publishInlineFeedback: (...parameters: any[]) => Promise<number>
 *   }
 * }} dependencies
 */
export function createGitHubFeedbackService(
  durableCore,
  { cipher, externalOrigin, now = () => Date.now(), verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof now !== "function" ||
    typeof verifier?.publishAggregateFeedback !== "function" ||
    typeof verifier.publishInlineFeedback !== "function"
  ) {
    throw new TypeError("GitHub feedback dependencies are invalid");
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError("GitHub feedback requires an HTTP origin");
  }
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;

  /** @param {string} evaluationId */
  function detailsUrl(evaluationId) {
    const target = new URL("/", origin);
    target.searchParams.set("view", "evaluations");
    target.searchParams.set("evaluation_id", evaluationId);
    return target.toString();
  }

  /** @param {any} bundle @param {any[]} findings */
  function materializeFindingFeedback(bundle, findings) {
    const fileChanges = new Map(
      durableCore
        .all(
          `SELECT id, before_path, after_path, patch
           FROM evaluation_file_changes
           WHERE evaluation_id = ?`,
          bundle.evaluation_id,
        )
        .map((/** @type {any} */ fileChange) => [fileChange?.id, fileChange]),
    );
    durableCore.transaction((/** @type {any} */ transaction) => {
      const existing = transaction.all(
        `SELECT finding_id
         FROM github_finding_feedback
         WHERE evaluation_id = ?`,
        bundle.evaluation_id,
      );
      if (existing.length !== 0) {
        if (
          existing.length !== findings.length ||
          existing.some(
            (/** @type {any} */ { finding_id: findingId }) =>
              !findings.some(({ id }) => id === findingId),
          )
        ) {
          throw new TypeError("GitHub Finding feedback set is invalid");
        }
        return;
      }
      for (const finding of findings) {
        const fileChange =
          finding.location.file_change_id === undefined
            ? undefined
            : fileChanges.get(finding.location.file_change_id);
        const coordinate = fileChange
          ? projectFrozenDiffLineRange(finding.location, fileChange)
          : null;
        transaction.run(
          `INSERT INTO github_finding_feedback (
             finding_id, evaluation_id, publication_status,
             path, side, start_line, line
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          finding.id,
          bundle.evaluation_id,
          coordinate ? "waiting" : "aggregate_only",
          coordinate?.path ?? null,
          coordinate?.side ?? null,
          coordinate?.start_line ?? null,
          coordinate?.line ?? null,
        );
      }
    });
  }

  /** @param {any} bundle @param {{code: string, detail: string}} failure */
  function recordBundleFailure(bundle, failure) {
    durableCore.transaction((/** @type {any} */ transaction) =>
      transaction.run(
        `UPDATE github_feedback_bundles
         SET publication_status = 'unavailable',
             error_code = ?, error_detail = ?
         WHERE evaluation_id = ? AND publication_status = 'waiting'`,
        failure.code,
        failure.detail,
        bundle.evaluation_id,
      ),
    );
  }

  /** @param {any} row @param {{code: string, detail: string}} failure */
  function recordFindingFailure(row, failure) {
    durableCore.transaction((/** @type {any} */ transaction) =>
      transaction.run(
        `UPDATE github_finding_feedback
         SET publication_status = 'unavailable',
             error_code = ?, error_detail = ?
         WHERE finding_id = ? AND publication_status = 'waiting'`,
        failure.code,
        failure.detail,
        row.finding_id,
      ),
    );
  }

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      while (true) {
        const [bundle] = durableCore.all(
          `SELECT
             github_feedback_bundles.evaluation_id,
             evaluations.base_commit,
             evaluations.head_commit,
             evaluation_results.outcome,
             github_automatic_evaluations.pull_request_number,
             github_repositories.forge_repository_id,
             github_repositories.name,
             github_connections.id AS connection_id,
             github_connections.app_id,
             github_connections.app_slug,
             github_connections.installation_id,
             github_connections.principal_id,
             github_connections.principal_login,
             github_connection_credentials.encrypted_credential
           FROM github_feedback_bundles
           JOIN evaluations
             ON evaluations.id = github_feedback_bundles.evaluation_id
           JOIN evaluation_results
             ON evaluation_results.evaluation_id =
                  github_feedback_bundles.evaluation_id
           JOIN github_automatic_evaluations
             ON github_automatic_evaluations.evaluation_id =
                  github_feedback_bundles.evaluation_id
           JOIN github_repositories
             ON github_repositories.repository_id = evaluations.repository_id
           JOIN github_connections
             ON github_connections.id = github_repositories.connection_id
           JOIN github_connection_credentials
             ON github_connection_credentials.connection_id =
                  github_connections.id
           WHERE github_feedback_bundles.publication_status = 'waiting'
           ORDER BY evaluations.created_at, evaluations.id
           LIMIT 1`,
        );
        if (!bundle) {
          break;
        }
        const evaluationId = /** @type {string} */ (bundle.evaluation_id);
        const findings = readEvaluationFindings(durableCore, evaluationId);
        materializeFindingFeedback(bundle, findings);
        const identity = {
          base_commit: /** @type {string} */ (bundle.base_commit),
          details_url: detailsUrl(evaluationId),
          evaluation_id: evaluationId,
          head_commit: /** @type {string} */ (bundle.head_commit),
          outcome: /** @type {string} */ (bundle.outcome),
        };
        const credential = cipher.decrypt(
          {
            appId: /** @type {number} */ (bundle.app_id),
            id: /** @type {string} */ (bundle.connection_id),
          },
          /** @type {string} */ (bundle.encrypted_credential),
        );
        const repository = {
          full_name: /** @type {string} */ (bundle.name),
          id: /** @type {number} */ (bundle.forge_repository_id),
        };
        try {
          const externalId = await verifier.publishAggregateFeedback(
            {
              app_id: bundle.app_id,
              app_slug: bundle.app_slug,
              client_id: credential.client_id,
              owner: {
                id: bundle.principal_id,
                login: bundle.principal_login,
                type: "User",
              },
              pem: credential.pem,
            },
            /** @type {number} */ (bundle.installation_id),
            repository,
            /** @type {number} */ (bundle.pull_request_number),
            formatGitHubAggregateFeedback(
              identity,
              /** @type {any[]} */ (findings),
            ),
          );
          const publishedAt = publicationTimestamp(now);
          durableCore.transaction((/** @type {any} */ transaction) =>
            transaction.run(
              `UPDATE github_feedback_bundles
               SET publication_status = 'succeeded',
                   external_id = ?, published_at = ?
               WHERE evaluation_id = ? AND publication_status = 'waiting'`,
              externalId,
              publishedAt,
              evaluationId,
            ),
          );
        } catch (error) {
          recordBundleFailure(bundle, githubPublicationFailure(error));
        }
        const inlineRows = durableCore.all(
          `SELECT github_finding_feedback.*,
                  findings.evidence, findings.remediation,
                  review_version_criteria.impact
           FROM github_finding_feedback
           JOIN findings
             ON findings.id = github_finding_feedback.finding_id
           JOIN review_runs ON review_runs.id = findings.review_run_id
           JOIN review_version_criteria
             ON review_version_criteria.review_version_id =
                  review_runs.review_version_id
            AND review_version_criteria.criterion_id = findings.criterion_id
           WHERE github_finding_feedback.evaluation_id = ?
             AND github_finding_feedback.publication_status = 'waiting'
           ORDER BY findings.rowid`,
          evaluationId,
        );
        for (const row of inlineRows) {
          try {
            const comment = {
              body: formatGitHubInlineFeedback(identity, {
                evidence: /** @type {string} */ (row?.evidence),
                id: /** @type {string} */ (row?.finding_id),
                impact: /** @type {string} */ (row?.impact),
                remediation: /** @type {string} */ (row?.remediation),
              }),
              commit_id: identity.head_commit,
              line: /** @type {number} */ (row?.line),
              path: /** @type {string} */ (row?.path),
              side: /** @type {"LEFT" | "RIGHT"} */ (row?.side),
              ...(row?.start_line === null
                ? {}
                : {
                    start_line: /** @type {number} */ (row?.start_line),
                    start_side: /** @type {"LEFT" | "RIGHT"} */ (row?.side),
                  }),
            };
            const externalId = await verifier.publishInlineFeedback(
              {
                app_id: bundle.app_id,
                app_slug: bundle.app_slug,
                client_id: credential.client_id,
                owner: {
                  id: bundle.principal_id,
                  login: bundle.principal_login,
                  type: "User",
                },
                pem: credential.pem,
              },
              /** @type {number} */ (bundle.installation_id),
              repository,
              /** @type {number} */ (bundle.pull_request_number),
              comment,
            );
            const publishedAt = publicationTimestamp(now);
            durableCore.transaction((/** @type {any} */ transaction) =>
              transaction.run(
                `UPDATE github_finding_feedback
                 SET publication_status = 'succeeded',
                     external_id = ?, published_at = ?
                 WHERE finding_id = ? AND publication_status = 'waiting'`,
                externalId,
                publishedAt,
                row?.finding_id,
              ),
            );
          } catch (error) {
            recordFindingFailure(row, githubPublicationFailure(error));
          }
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
