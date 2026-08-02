import { createGitHubCommitStatusService } from "./github-commit-status-service.js";
import { createGitHubFeedbackService } from "./github-feedback-service.js";
import { createGitHubWaiverFollowupService } from "./github-waiver-followup-service.js";

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: any,
 *   externalOrigin: string,
 *   ioPool: any,
 *   now: () => number,
 *   verifier: {
 *     publishAggregateFeedback: (...parameters: any[]) => Promise<number>,
 *     publishCommitStatus: (...parameters: any[]) => Promise<number>,
 *     publishInlineFeedback: (...parameters: any[]) => Promise<number>,
 *     publishReviewCommentReply: (...parameters: any[]) => Promise<number>,
 *     reconcileAggregateFeedback: (...parameters: any[]) => Promise<number | null>,
 *     reconcileCommitStatus: (...parameters: any[]) => Promise<number | null>,
 *     reconcileInlineFeedback: (...parameters: any[]) => Promise<number | null>,
 *     reconcileReviewCommentReply: (...parameters: any[]) => Promise<number | null>
 *   }
 * }} dependencies
 */
export function createGitHubPublicationServices(
  durableCore,
  { cipher, externalOrigin, ioPool, now, verifier },
) {
  const commitStatuses = createGitHubCommitStatusService(durableCore, {
    cipher,
    externalOrigin,
    ioPool,
    now,
    verifier: {
      publishCommitStatus: verifier.publishCommitStatus,
      reconcileCommitStatus: verifier.reconcileCommitStatus,
    },
  });
  const feedback = createGitHubFeedbackService(durableCore, {
    cipher,
    externalOrigin,
    ioPool,
    now,
    verifier: {
      publishAggregateFeedback: verifier.publishAggregateFeedback,
      publishInlineFeedback: verifier.publishInlineFeedback,
      reconcileAggregateFeedback: verifier.reconcileAggregateFeedback,
      reconcileInlineFeedback: verifier.reconcileInlineFeedback,
    },
  });
  const waiverFollowups = createGitHubWaiverFollowupService(durableCore, {
    cipher,
    externalOrigin,
    ioPool,
    now,
    verifier,
  });
  return {
    destroy() {
      commitStatuses.destroy();
      feedback.destroy();
      waiverFollowups.destroy();
    },
    start() {
      commitStatuses.start();
      feedback.start();
      waiverFollowups.start();
    },
  };
}
