import {
  formatForgejoAggregateFeedback,
  formatForgejoInlineFeedback,
} from "./forgejo-feedback.js";
import { materializeForgejoFindingFeedback } from "./forgejo-finding-feedback-materialization.js";
import { readEvaluationFindings } from "../evaluation/evaluation-result-children.js";
import {
  attemptForgejoDelivery,
  recordForgejoDeliveryHealth,
} from "./forgejo-delivery-service.js";
import {
  readForgejoAggregateTarget,
  readForgejoInlineTarget,
} from "./forgejo-delivery-target.js";
import { createIoDutyScheduler } from "../io-execution-pool.js";
const PUBLICATION_INTERVAL_MS = 1_000;

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connectionId: string, encrypted: string) => string},
 *   externalOrigin: string,
 *   ioPool: {run: (duty: "delivery", operation: () => unknown) => Promise<unknown>},
 *   now?: () => number,
 *   verifier: {
 *     publishAggregateFeedback: (connection: any, repository: any, pullRequestNumber: number, body: string) => Promise<number>,
 *     publishInlineFeedback: (connection: any, repository: any, pullRequestNumber: number, comment: any) => Promise<number>,
 *     reconcileAggregateFeedback: (connection: any, repository: any, pullRequestNumber: number, body: string) => Promise<number | null>,
 *     reconcileInlineFeedback: (connection: any, repository: any, pullRequestNumber: number, comment: any) => Promise<number | null>
 *   }
 * }} dependencies
 */
export function createForgejoFeedbackService(
  durableCore,
  { cipher, externalOrigin, ioPool, now = () => Date.now(), verifier },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof verifier?.publishAggregateFeedback !== "function" ||
    typeof verifier.publishInlineFeedback !== "function" ||
    typeof verifier.reconcileAggregateFeedback !== "function" ||
    typeof verifier.reconcileInlineFeedback !== "function"
  ) {
    throw new TypeError("Forgejo feedback dependencies are invalid");
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError("Forgejo feedback requires an HTTP origin");
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

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      const missingFindingFeedback = durableCore.all(
        `SELECT evaluation_id, publication_status, error_code, error_detail
         FROM forgejo_feedback_bundles
         WHERE EXISTS (
           SELECT 1 FROM findings
           WHERE findings.evaluation_id = forgejo_feedback_bundles.evaluation_id
         )
           AND NOT EXISTS (
             SELECT 1 FROM forgejo_finding_feedback
             WHERE forgejo_finding_feedback.evaluation_id =
                   forgejo_feedback_bundles.evaluation_id
           )
         ORDER BY evaluation_id`,
      );
      for (const bundle of missingFindingFeedback) {
        const evaluationId = /** @type {string} */ (bundle.evaluation_id);
        materializeForgejoFindingFeedback(
          durableCore,
          bundle,
          readEvaluationFindings(durableCore, evaluationId),
        );
      }

      const bundles = durableCore.all(
        `SELECT
           forgejo_feedback_bundles.evaluation_id,
           forgejo_feedback_bundles.publication_status,
           evaluations.repository_id,
           evaluations.base_commit,
           evaluations.head_commit,
           evaluation_results.outcome,
           forgejo_automatic_evaluations.pull_request_number,
           forgejo_repositories.forge_repository_id,
           forgejo_repositories.name,
           forgejo_connections.id AS connection_id,
           forgejo_connections.base_url,
           forgejo_connection_credentials.encrypted_credential
         FROM forgejo_feedback_bundles
         JOIN evaluations
           ON evaluations.id = forgejo_feedback_bundles.evaluation_id
         JOIN evaluation_results
           ON evaluation_results.evaluation_id =
                forgejo_feedback_bundles.evaluation_id
         JOIN forgejo_automatic_evaluations
           ON forgejo_automatic_evaluations.evaluation_id =
                forgejo_feedback_bundles.evaluation_id
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id = evaluations.repository_id
         JOIN forgejo_connections
           ON forgejo_connections.id = forgejo_repositories.connection_id
         JOIN forgejo_connection_credentials
           ON forgejo_connection_credentials.connection_id =
                forgejo_connections.id
         WHERE (
           forgejo_feedback_bundles.publication_status = 'waiting'
            OR EXISTS (
              SELECT 1
              FROM forgejo_finding_feedback
              WHERE forgejo_finding_feedback.evaluation_id =
                    forgejo_feedback_bundles.evaluation_id
                AND forgejo_finding_feedback.publication_status = 'waiting'
            )
         )
           AND forgejo_connections.lifecycle = 'enabled'
           AND forgejo_connections.health = 'healthy'
           AND EXISTS (
             SELECT 1 FROM repositories
             WHERE repositories.id = evaluations.repository_id
               AND repositories.lifecycle != 'retired'
               AND repositories.health = 'healthy'
           )
         ORDER BY evaluations.created_at, evaluations.id`,
      );
      for (const bundle of bundles) {
        const evaluationId = /** @type {string} */ (bundle.evaluation_id);
        const findings = readEvaluationFindings(durableCore, evaluationId);
        materializeForgejoFindingFeedback(durableCore, bundle, findings);
        const identity = {
          base_commit: /** @type {string} */ (bundle.base_commit),
          details_url: detailsUrl(evaluationId),
          evaluation_id: evaluationId,
          head_commit: /** @type {string} */ (bundle.head_commit),
          outcome: /** @type {string} */ (bundle.outcome),
        };
        const repository = {
          full_name: /** @type {string} */ (bundle.name),
          id: /** @type {number} */ (bundle.forge_repository_id),
        };
        const authentication = () => ({
          base_url: /** @type {string} */ (bundle.base_url),
          token: cipher.decrypt(
            /** @type {string} */ (bundle.connection_id),
            /** @type {string} */ (bundle.encrypted_credential),
          ),
        });
        if (bundle.publication_status === "waiting") {
          const aggregate = formatForgejoAggregateFeedback(
            identity,
            /** @type {any[]} */ (findings),
          );
          const aggregateTarget = {
            body: aggregate,
            pull_request_number: bundle.pull_request_number,
            repository_id: bundle.forge_repository_id,
          };
          const deliverAggregate = (
            /** @type {any} */ method,
            /** @type {string} */ deliveryTarget,
          ) => {
            const target = readForgejoAggregateTarget(
              deliveryTarget,
              aggregateTarget,
              repository.id,
            );
            return method(
              authentication(),
              repository,
              target.pullRequestNumber,
              target.body,
            );
          };
          await attemptForgejoDelivery(durableCore, {
            connectionId: /** @type {string} */ (bundle.connection_id),
            create: (target) =>
              deliverAggregate(verifier.publishAggregateFeedback, target),
            now,
            onDefinitive: (transaction, failure, attemptedAt) => {
              transaction.run(
                `UPDATE forgejo_feedback_bundles
                 SET publication_status = 'unavailable',
                     external_id = NULL, published_at = NULL,
                     error_code = ?, error_detail = ?
                 WHERE evaluation_id = ? AND publication_status = 'waiting'`,
                failure.code,
                failure.detail,
                evaluationId,
              );
              recordForgejoDeliveryHealth(
                transaction,
                /** @type {string} */ (bundle.connection_id),
                attemptedAt,
                failure,
              );
            },
            onSuccess: (transaction, externalId, publishedAt) =>
              transaction.run(
                `UPDATE forgejo_feedback_bundles
                 SET publication_status = 'succeeded',
                     external_id = ?, published_at = ?,
                     error_code = NULL, error_detail = NULL
                 WHERE evaluation_id = ? AND publication_status = 'waiting'`,
                externalId,
                publishedAt,
                evaluationId,
              ),
            reconcile: (target) =>
              deliverAggregate(verifier.reconcileAggregateFeedback, target),
            repositoryId: /** @type {string} */ (bundle.repository_id),
            sourceId: evaluationId,
            surface: "aggregate_feedback",
            target: JSON.stringify(aggregateTarget),
          });
        }
        const inlineRows = durableCore.all(
          `SELECT forgejo_finding_feedback.*,
                  findings.evidence, findings.remediation,
                  review_version_criteria.impact
           FROM forgejo_finding_feedback
           JOIN findings
             ON findings.id = forgejo_finding_feedback.finding_id
           JOIN review_runs ON review_runs.id = findings.review_run_id
           JOIN review_version_criteria
             ON review_version_criteria.review_version_id =
                  review_runs.review_version_id
            AND review_version_criteria.criterion_id = findings.criterion_id
           WHERE forgejo_finding_feedback.evaluation_id = ?
             AND forgejo_finding_feedback.publication_status = 'waiting'
           ORDER BY findings.rowid`,
          evaluationId,
        );
        for (const row of inlineRows) {
          const comment = {
            body: formatForgejoInlineFeedback(identity, {
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
                  start_side: /** @type {"LEFT" | "RIGHT"} */ (row?.start_side),
                }),
          };
          const inlineTarget = {
            ...comment,
            pull_request_number: bundle.pull_request_number,
            repository_id: bundle.forge_repository_id,
          };
          const deliverInline = (
            /** @type {any} */ method,
            /** @type {string} */ deliveryTarget,
          ) => {
            const target = readForgejoInlineTarget(
              deliveryTarget,
              inlineTarget,
              repository.id,
            );
            return method(
              authentication(),
              repository,
              target.pullRequestNumber,
              target.comment,
            );
          };
          await attemptForgejoDelivery(durableCore, {
            connectionId: /** @type {string} */ (bundle.connection_id),
            create: (target) =>
              deliverInline(verifier.publishInlineFeedback, target),
            now,
            onDefinitive: (transaction, failure, attemptedAt) => {
              transaction.run(
                `UPDATE forgejo_finding_feedback
                 SET publication_status = 'unavailable',
                     external_id = NULL, published_at = NULL,
                     error_code = ?, error_detail = ?
                 WHERE finding_id = ? AND publication_status = 'waiting'`,
                failure.code,
                failure.detail,
                row.finding_id,
              );
              recordForgejoDeliveryHealth(
                transaction,
                /** @type {string} */ (bundle.connection_id),
                attemptedAt,
                failure,
              );
            },
            onSuccess: (transaction, externalId, publishedAt) =>
              transaction.run(
                `UPDATE forgejo_finding_feedback
                 SET publication_status = 'succeeded',
                     external_id = ?, published_at = ?,
                     error_code = NULL, error_detail = NULL
                 WHERE finding_id = ? AND publication_status = 'waiting'`,
                externalId,
                publishedAt,
                row.finding_id,
              ),
            reconcile: (target) =>
              deliverInline(verifier.reconcileInlineFeedback, target),
            repositoryId: /** @type {string} */ (bundle.repository_id),
            sourceId: /** @type {string} */ (row.finding_id),
            surface: "inline_feedback",
            target: JSON.stringify(inlineTarget),
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
