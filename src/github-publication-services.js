import { createGitHubCommitStatusService } from "./github-commit-status-service.js";
import { createGitHubFeedbackService } from "./github-feedback-service.js";

/**
 * @param {any} durableCore
 * @param {{
 *   cipher: any,
 *   externalOrigin: string,
 *   now: () => number,
 *   verifier: {
 *     publishAggregateFeedback: (...parameters: any[]) => Promise<number>,
 *     publishCommitStatus: (...parameters: any[]) => Promise<void>,
 *     publishInlineFeedback: (...parameters: any[]) => Promise<number>
 *   }
 * }} dependencies
 */
export function createGitHubPublicationServices(
  durableCore,
  { cipher, externalOrigin, now, verifier },
) {
  const commitStatuses = createGitHubCommitStatusService(durableCore, {
    cipher,
    externalOrigin,
    now,
    verifier: { publishCommitStatus: verifier.publishCommitStatus },
  });
  const feedback = createGitHubFeedbackService(durableCore, {
    cipher,
    externalOrigin,
    now,
    verifier: {
      publishAggregateFeedback: verifier.publishAggregateFeedback,
      publishInlineFeedback: verifier.publishInlineFeedback,
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
