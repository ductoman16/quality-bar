import { createForgejoCommitStatusService } from "./forgejo-commit-status-service.js";
import { createForgejoFeedbackService } from "./forgejo-feedback-service.js";

/** @param {any} durableCore @param {any} dependencies */
export function createForgejoPublicationServices(durableCore, dependencies) {
  const status = createForgejoCommitStatusService(durableCore, dependencies);
  const feedback = createForgejoFeedbackService(durableCore, dependencies);
  return {
    async publishWaiting() {
      await status.publishWaiting();
      await feedback.publishWaiting();
    },
    start() {
      status.start();
      feedback.start();
    },
    stop() {
      status.destroy();
      feedback.destroy();
    },
  };
}
