import {
  formatGitHubAggregateFeedback,
  formatGitHubInlineFeedback,
  projectFrozenDiffLineRange,
} from "./github-feedback.js";
import { attemptGitHubDelivery } from "./github-delivery-service.js";
import { recordGitHubDeliveryHealth } from "./github-delivery-service.js";
import {
  readAggregateDeliveryTarget,
  readInlineDeliveryTarget,
} from "./github-feedback-delivery-target.js";
import { createForgeFeedbackMaterializer } from "../forge/feedback/materializer.js";

const MISSING_MATERIALIZATION_SQL = `
  SELECT evaluation_id, publication_status, error_code, error_detail
  FROM github_feedback_bundles
  WHERE EXISTS (
    SELECT 1 FROM findings
    WHERE findings.evaluation_id =
          github_feedback_bundles.evaluation_id
  )
    AND NOT EXISTS (
      SELECT 1 FROM github_finding_feedback
      WHERE github_finding_feedback.evaluation_id =
            github_feedback_bundles.evaluation_id
    )
  ORDER BY evaluation_id`;

const BUNDLES_SQL = `
  SELECT
      github_feedback_bundles.evaluation_id,
      github_feedback_bundles.publication_status,
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
       OR EXISTS (
         SELECT 1
         FROM github_finding_feedback
         WHERE github_finding_feedback.evaluation_id =
               github_feedback_bundles.evaluation_id
           AND github_finding_feedback.publication_status = 'waiting'
       )
    ORDER BY evaluations.created_at, evaluations.id`;

const INLINE_ROWS_SQL = `
  SELECT github_finding_feedback.*,
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
  ORDER BY findings.rowid`;

/** @param {any} durableCore @param {any} bundle @param {any[]} findings */
function materializeGitHubFindingFeedback(durableCore, bundle, findings) {
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
      const unavailable =
        coordinate && bundle.publication_status === "unavailable";
      const errorDetail =
        bundle.error_code === "github_connection_retired"
          ? "GitHub inline feedback publication is unavailable because the GitHub Connection is retired"
          : bundle.error_detail;
      transaction.run(
        `INSERT INTO github_finding_feedback (
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
function validateGitHubFeedbackVerifier(verifier) {
  if (
    typeof verifier?.publishAggregateFeedback !== "function" ||
    typeof verifier.publishInlineFeedback !== "function" ||
    typeof verifier.reconcileAggregateFeedback !== "function" ||
    typeof verifier.reconcileInlineFeedback !== "function"
  ) {
    throw new TypeError("GitHub feedback dependencies are invalid");
  }
}

/** @param {any} cipher @param {any} bundle */
function createGitHubAuthentication(cipher, bundle) {
  return () => {
    const credential = cipher.decrypt(
      {
        appId: /** @type {number} */ (bundle.app_id),
        id: /** @type {string} */ (bundle.connection_id),
      },
      /** @type {string} */ (bundle.encrypted_credential),
    );
    return {
      app_id: bundle.app_id,
      app_slug: bundle.app_slug,
      client_id: credential.client_id,
      owner: {
        id: bundle.principal_id,
        login: bundle.principal_login,
        type: "User",
      },
      pem: credential.pem,
    };
  };
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
function attemptGitHubAggregateDelivery({
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
    const target = readAggregateDeliveryTarget(
      deliveryTarget,
      aggregateTarget,
      repository.id,
    );
    return method(
      authentication(),
      bundle.installation_id,
      repository,
      target.pullRequestNumber,
      target.body,
    );
  };
  return attemptGitHubDelivery(durableCore, {
    connectionId: /** @type {string} */ (bundle.connection_id),
    create: (target) =>
      deliverAggregate(verifier.publishAggregateFeedback, target),
    onDefinitive: (transaction, failure, attemptedAt) => {
      transaction.run(
        `UPDATE github_feedback_bundles
         SET publication_status = 'unavailable',
             error_code = ?, error_detail = ?
         WHERE evaluation_id = ? AND publication_status = 'waiting'`,
        failure.code,
        failure.detail,
        bundle.evaluation_id,
      );
      recordGitHubDeliveryHealth(
        transaction,
        /** @type {string} */ (bundle.connection_id),
        attemptedAt,
        failure,
      );
    },
    now,
    onSuccess: (transaction, externalId, publishedAt) =>
      transaction.run(
        `UPDATE github_feedback_bundles
         SET publication_status = 'succeeded',
             external_id = ?, published_at = ?
         WHERE evaluation_id = ? AND publication_status = 'waiting'`,
        externalId,
        publishedAt,
        evaluationId,
      ),
    reconcile: (target) =>
      deliverAggregate(verifier.reconcileAggregateFeedback, target),
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
function attemptGitHubFindingDelivery({
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
    const target = readInlineDeliveryTarget(
      deliveryTarget,
      inlineTarget,
      repository.id,
    );
    return method(
      authentication(),
      bundle.installation_id,
      repository,
      target.pullRequestNumber,
      target.comment,
    );
  };
  return attemptGitHubDelivery(durableCore, {
    connectionId: /** @type {string} */ (bundle.connection_id),
    create: (target) => deliverInline(verifier.publishInlineFeedback, target),
    onDefinitive: (transaction, failure, attemptedAt) => {
      transaction.run(
        `UPDATE github_finding_feedback
         SET publication_status = 'unavailable',
             error_code = ?, error_detail = ?
         WHERE finding_id = ? AND publication_status = 'waiting'`,
        failure.code,
        failure.detail,
        row.finding_id,
      );
      recordGitHubDeliveryHealth(
        transaction,
        /** @type {string} */ (bundle.connection_id),
        attemptedAt,
        failure,
      );
    },
    now,
    onSuccess: (transaction, externalId, publishedAt) =>
      transaction.run(
        `UPDATE github_finding_feedback
         SET publication_status = 'succeeded',
             external_id = ?, published_at = ?
         WHERE finding_id = ? AND publication_status = 'waiting'`,
        externalId,
        publishedAt,
        row?.finding_id,
      ),
    reconcile: (target) =>
      deliverInline(verifier.reconcileInlineFeedback, target),
    sourceId: /** @type {string} */ (row.finding_id),
    surface: "inline_feedback",
    target: JSON.stringify(inlineTarget),
  });
}

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: {decrypt: (connection: {appId: number, id: string}, encrypted: string) => any},
 *   externalOrigin: string,
 *   ioPool: {run: (duty: "delivery", operation: () => unknown) => Promise<unknown>},
 *   now?: () => number,
 *   verifier: {
 *     publishAggregateFeedback: (...parameters: any[]) => Promise<number>,
 *     publishInlineFeedback: (...parameters: any[]) => Promise<number>,
 *     reconcileAggregateFeedback: (...parameters: any[]) => Promise<number | null>,
 *     reconcileInlineFeedback: (...parameters: any[]) => Promise<number | null>
 *   }
 * }} dependencies
 */
export function createGitHubFeedbackService(durableCore, dependencies) {
  return createForgeFeedbackMaterializer(durableCore, {
    ...dependencies,
    adapter: {
      label: "GitHub",
      validateVerifier: validateGitHubFeedbackVerifier,
      sql: {
        missingMaterialization: MISSING_MATERIALIZATION_SQL,
        bundles: BUNDLES_SQL,
        inlineRows: INLINE_ROWS_SQL,
      },
      materializeFindingFeedback: materializeGitHubFindingFeedback,
      createAuthentication: createGitHubAuthentication,
      formatAggregate: formatGitHubAggregateFeedback,
      formatInline: formatGitHubInlineFeedback,
      attemptAggregateDelivery: attemptGitHubAggregateDelivery,
      attemptFindingDelivery: attemptGitHubFindingDelivery,
    },
  });
}
