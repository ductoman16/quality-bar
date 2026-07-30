import { recordGitHubDeliveryHealth } from "./github-delivery-service.js";

/** @param {any} transaction @param {any} bundle @param {any} failure @param {number} attemptedAt */
export function recordGitHubBundleDeliveryFailure(
  transaction,
  bundle,
  failure,
  attemptedAt,
) {
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
}

/** @param {any} transaction @param {any} bundle @param {any} row @param {any} failure @param {number} attemptedAt */
export function recordGitHubFindingDeliveryFailure(
  transaction,
  bundle,
  row,
  failure,
  attemptedAt,
) {
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
}
