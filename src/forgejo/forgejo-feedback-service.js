import {
  formatForgejoAggregateFeedback,
  formatForgejoInlineFeedback,
  projectForgejoDiffLineRange,
} from "./forgejo-feedback.js";
import {
  attemptForgejoDelivery,
  recordForgejoDeliveryHealth,
} from "./forgejo-delivery-service.js";
import {
  readForgejoAggregateTarget,
  readForgejoInlineTarget,
} from "./forgejo-delivery-target.js";
import { createForgeFeedbackMaterializer } from "../forge/feedback/materializer.js";

const MISSING_MATERIALIZATION_SQL = `
  SELECT evaluation_id, publication_status, error_code, error_detail
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
  ORDER BY evaluation_id`;

const BUNDLES_SQL = `
  SELECT
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
  ORDER BY evaluations.created_at, evaluations.id`;

const INLINE_ROWS_SQL = `
  SELECT forgejo_finding_feedback.*,
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
  ORDER BY findings.rowid`;

/** @param {any} durableCore @param {any} bundle @param {any[]} findings */
function materializeForgejoFindingFeedback(durableCore, bundle, findings) {
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
       FROM forgejo_finding_feedback
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
        throw new TypeError("Forgejo Finding feedback set is invalid");
      }
      return;
    }
    for (const finding of findings) {
      const fileChange =
        finding.location.file_change_id === undefined
          ? undefined
          : fileChanges.get(finding.location.file_change_id);
      const coordinate = fileChange
        ? projectForgejoDiffLineRange(finding.location, fileChange)
        : null;
      const unavailable =
        coordinate && bundle.publication_status === "unavailable";
      const errorDetail =
        bundle.error_code === "forgejo_connection_retired"
          ? "Forgejo inline feedback publication is unavailable because the Forgejo Connection is retired"
          : bundle.error_detail;
      transaction.run(
        `INSERT INTO forgejo_finding_feedback (
           finding_id, evaluation_id, publication_status,
           path, side, start_line, start_side, line,
           error_code, error_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        finding.id,
        bundle.evaluation_id,
        coordinate
          ? unavailable
            ? "unavailable"
            : "waiting"
          : "aggregate_only",
        coordinate?.path ?? null,
        coordinate?.side ?? null,
        coordinate?.start_line ?? null,
        coordinate?.start_side ?? null,
        coordinate?.line ?? null,
        unavailable ? bundle.error_code : null,
        unavailable ? errorDetail : null,
      );
    }
  });
}

/** @param {any} verifier */
function validateForgejoFeedbackVerifier(verifier) {
  if (
    typeof verifier?.publishAggregateFeedback !== "function" ||
    typeof verifier.publishInlineFeedback !== "function" ||
    typeof verifier.reconcileAggregateFeedback !== "function" ||
    typeof verifier.reconcileInlineFeedback !== "function"
  ) {
    throw new TypeError("Forgejo feedback dependencies are invalid");
  }
}

/** @param {any} cipher @param {any} bundle */
function createForgejoAuthentication(cipher, bundle) {
  return () => ({
    base_url: /** @type {string} */ (bundle.base_url),
    token: cipher.decrypt(
      /** @type {string} */ (bundle.connection_id),
      /** @type {string} */ (bundle.encrypted_credential),
    ),
  });
}

/**
 * @param {{
 *   durableCore: any,
 *   verifier: any,
 *   bundle: any,
 *   evaluationId: string,
 *   repository: {full_name: string, id: number},
 *   authentication: () => any,
 *   aggregateTarget: any,
 *   now: () => number,
 * }} input
 */
function attemptForgejoAggregateDelivery({
  durableCore,
  verifier,
  bundle,
  evaluationId,
  repository,
  authentication,
  aggregateTarget,
  now,
}) {
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
  return attemptForgejoDelivery(durableCore, {
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

/**
 * @param {{
 *   durableCore: any,
 *   verifier: any,
 *   bundle: any,
 *   row: any,
 *   repository: {full_name: string, id: number},
 *   authentication: () => any,
 *   inlineTarget: any,
 *   now: () => number,
 * }} input
 */
function attemptForgejoFindingDelivery({
  durableCore,
  verifier,
  bundle,
  row,
  repository,
  authentication,
  inlineTarget,
  now,
}) {
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
  return attemptForgejoDelivery(durableCore, {
    connectionId: /** @type {string} */ (bundle.connection_id),
    create: (target) => deliverInline(verifier.publishInlineFeedback, target),
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
export function createForgejoFeedbackService(durableCore, dependencies) {
  return createForgeFeedbackMaterializer(durableCore, {
    ...dependencies,
    adapter: {
      label: "Forgejo",
      validateVerifier: validateForgejoFeedbackVerifier,
      sql: {
        missingMaterialization: MISSING_MATERIALIZATION_SQL,
        bundles: BUNDLES_SQL,
        inlineRows: INLINE_ROWS_SQL,
      },
      materializeFindingFeedback: materializeForgejoFindingFeedback,
      createAuthentication: createForgejoAuthentication,
      formatAggregate: formatForgejoAggregateFeedback,
      formatInline: formatForgejoInlineFeedback,
      attemptAggregateDelivery: attemptForgejoAggregateDelivery,
      attemptFindingDelivery: attemptForgejoFindingDelivery,
    },
  });
}
