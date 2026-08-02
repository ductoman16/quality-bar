import {
  attemptGitHubDelivery,
  recordGitHubDeliveryHealth,
} from "./github-delivery-service.js";
import { createIoDutyScheduler } from "./io-execution-pool.js";
import {
  formatWaiverAdjudicationFollowup,
  formatWaiverDecisionFollowup,
} from "./waiver-followup.js";

const PUBLICATION_INTERVAL_MS = 1_000;

/** @param {string} serialized @param {any} expected */
function target(serialized, expected) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("GitHub waiver follow-up delivery target is invalid");
  }
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new TypeError("GitHub waiver follow-up delivery target is invalid");
  }
  return parsed;
}

/** @param {any} durableCore @param {any} dependencies */
export function createGitHubWaiverFollowupService(
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
    typeof verifier?.reconcileAggregateFeedback !== "function" ||
    typeof verifier?.publishReviewCommentReply !== "function" ||
    typeof verifier?.reconcileReviewCommentReply !== "function"
  ) {
    throw new TypeError("GitHub waiver follow-up dependencies are invalid");
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError("GitHub waiver follow-up requires an HTTP origin");
  }
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;

  /** @param {string} evaluationId */
  function detailsUrl(evaluationId) {
    const url = new URL("/", origin);
    url.searchParams.set("view", "evaluations");
    url.searchParams.set("evaluation_id", evaluationId);
    return url.toString();
  }

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      const rows = durableCore.all(
        `SELECT followups.waiver_adjudication_id, followups.evaluation_id,
                followups.outcome,
                adjudications.base_commit, adjudications.head_commit,
                automatic.pull_request_number,
                repositories.forge_repository_id, repositories.name,
                connections.id AS connection_id, connections.app_id,
                connections.app_slug, connections.installation_id,
                connections.principal_id, connections.principal_login,
                credentials.encrypted_credential
         FROM github_waiver_adjudication_followups AS followups
         JOIN waiver_adjudications AS adjudications
           ON adjudications.id = followups.waiver_adjudication_id
         JOIN github_automatic_evaluations AS automatic
           ON automatic.evaluation_id = followups.evaluation_id
         JOIN github_repositories AS repositories
           ON repositories.repository_id = automatic.repository_id
         JOIN github_connections AS connections
           ON connections.id = repositories.connection_id
         JOIN github_connection_credentials AS credentials
           ON credentials.connection_id = connections.id
         WHERE followups.publication_status = 'waiting'
            OR EXISTS (SELECT 1 FROM github_waiver_decision_followups AS local
                       WHERE local.waiver_adjudication_id = followups.waiver_adjudication_id
                         AND local.publication_status = 'waiting')
         ORDER BY adjudications.rowid`,
      );
      for (const row of rows) {
        const repository = {
          full_name: /** @type {string} */ (row.name),
          id: /** @type {number} */ (row.forge_repository_id),
        };
        const authentication = () => {
          const credential = cipher.decrypt(
            { appId: row.app_id, id: row.connection_id },
            row.encrypted_credential,
          );
          return {
            app_id: row.app_id,
            app_slug: row.app_slug,
            client_id: credential.client_id,
            owner: {
              id: row.principal_id,
              login: row.principal_login,
              type: "User",
            },
            pem: credential.pem,
          };
        };
        const identity = {
          adjudication_id: row.waiver_adjudication_id,
          base_commit: row.base_commit,
          details_url: detailsUrl(row.evaluation_id),
          evaluation_id: row.evaluation_id,
          head_commit: row.head_commit,
          outcome: row.outcome,
        };
        const decisions = durableCore.all(
          `SELECT decisions.outcome, decisions.explanation,
                  decisions.error_code, decisions.error_detail,
                  decisions.waiver_request_id AS request_id,
                  requests.finding_id
           FROM waiver_decisions AS decisions
           JOIN waiver_requests AS requests ON requests.id = decisions.waiver_request_id
           WHERE decisions.waiver_adjudication_id = ? ORDER BY decisions.rowid`,
          row.waiver_adjudication_id,
        );
        const aggregateBody = formatWaiverAdjudicationFollowup(
          identity,
          decisions,
        );
        const aggregateTarget = {
          body: aggregateBody,
          pull_request_number: row.pull_request_number,
          repository_id: row.forge_repository_id,
        };
        const aggregate = durableCore.get(
          "SELECT publication_status FROM github_waiver_adjudication_followups WHERE waiver_adjudication_id = ?",
          row.waiver_adjudication_id,
        );
        if (aggregate?.publication_status === "waiting") {
          const deliver = (
            /** @type {any} */ method,
            /** @type {string} */ serialized,
          ) => {
            const input = target(serialized, aggregateTarget);
            return method(
              authentication(),
              row.installation_id,
              repository,
              input.pull_request_number,
              input.body,
            );
          };
          await attemptGitHubDelivery(durableCore, {
            connectionId: row.connection_id,
            create: (serialized) =>
              deliver(verifier.publishAggregateFeedback, serialized),
            reconcile: (serialized) =>
              deliver(verifier.reconcileAggregateFeedback, serialized),
            now,
            sourceId: `waiver-adjudication:${row.waiver_adjudication_id}`,
            surface: "aggregate_feedback",
            target: JSON.stringify(aggregateTarget),
            onDefinitive(transaction, failure, attemptedAt) {
              transaction.run(
                "UPDATE github_waiver_adjudication_followups SET publication_status = 'unavailable', error_code = ?, error_detail = ? WHERE waiver_adjudication_id = ? AND publication_status = 'waiting'",
                failure.code,
                failure.detail,
                row.waiver_adjudication_id,
              );
              recordGitHubDeliveryHealth(
                transaction,
                row.connection_id,
                attemptedAt,
                failure,
              );
            },
            onSuccess(transaction, externalId, publishedAt) {
              transaction.run(
                "UPDATE github_waiver_adjudication_followups SET publication_status = 'succeeded', external_id = ?, published_at = ? WHERE waiver_adjudication_id = ? AND publication_status = 'waiting'",
                externalId,
                publishedAt,
                row.waiver_adjudication_id,
              );
            },
          });
        }
        const locals = durableCore.all(
          `SELECT local.waiver_decision_id, local.original_external_id,
                  decisions.outcome, decisions.explanation,
                  decisions.waiver_request_id AS request_id, requests.finding_id
           FROM github_waiver_decision_followups AS local
           JOIN waiver_decisions AS decisions ON decisions.id = local.waiver_decision_id
           JOIN waiver_requests AS requests ON requests.id = decisions.waiver_request_id
           WHERE local.waiver_adjudication_id = ? AND local.publication_status = 'waiting'
           ORDER BY decisions.rowid`,
          row.waiver_adjudication_id,
        );
        for (const local of locals) {
          const body = formatWaiverDecisionFollowup(identity, local);
          const replyTarget = {
            body,
            original_comment_id: local.original_external_id,
            pull_request_number: row.pull_request_number,
            repository_id: row.forge_repository_id,
          };
          const deliver = (
            /** @type {any} */ method,
            /** @type {string} */ serialized,
          ) => {
            const input = target(serialized, replyTarget);
            return method(
              authentication(),
              row.installation_id,
              repository,
              input.pull_request_number,
              input.original_comment_id,
              input.body,
            );
          };
          await attemptGitHubDelivery(durableCore, {
            connectionId: row.connection_id,
            create: (serialized) =>
              deliver(verifier.publishReviewCommentReply, serialized),
            reconcile: (serialized) =>
              deliver(verifier.reconcileReviewCommentReply, serialized),
            now,
            sourceId: `waiver-decision:${local.waiver_decision_id}:${local.finding_id}`,
            surface: "inline_feedback",
            target: JSON.stringify(replyTarget),
            onDefinitive(transaction, failure, attemptedAt) {
              transaction.run(
                "UPDATE github_waiver_decision_followups SET publication_status = 'unavailable', error_code = ?, error_detail = ? WHERE waiver_decision_id = ? AND publication_status = 'waiting'",
                failure.code,
                failure.detail,
                local.waiver_decision_id,
              );
              recordGitHubDeliveryHealth(
                transaction,
                row.connection_id,
                attemptedAt,
                failure,
              );
            },
            onSuccess(transaction, externalId, publishedAt) {
              transaction.run(
                "UPDATE github_waiver_decision_followups SET publication_status = 'succeeded', external_id = ?, published_at = ? WHERE waiver_decision_id = ? AND publication_status = 'waiting'",
                externalId,
                publishedAt,
                local.waiver_decision_id,
              );
            },
          });
        }
      }
    } finally {
      running = false;
    }
  }
  const schedule = createIoDutyScheduler(ioPool, "delivery", publishWaiting);
  return {
    destroy() {
      if (timer) {
        clearInterval(timer);
      }
      timer = null;
      schedule.cancel();
    },
    publishWaiting,
    start() {
      if (timer) {
        return;
      }
      schedule.background();
      timer = setInterval(schedule.background, PUBLICATION_INTERVAL_MS);
      timer.unref?.();
    },
  };
}
