import { createGitHubCommitStatusService } from "./github-commit-status-service.js";
import { createGitHubFeedbackService } from "./github-feedback-service.js";

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
 *     reconcileAggregateFeedback: (...parameters: any[]) => Promise<number | null>,
 *     reconcileCommitStatus: (...parameters: any[]) => Promise<number | null>,
 *     reconcileInlineFeedback: (...parameters: any[]) => Promise<number | null>
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
  return {
    destroy() {
      commitStatuses.destroy();
      feedback.destroy();
    },
    start() {
      commitStatuses.start();
      feedback.start();
    },
  };
}
