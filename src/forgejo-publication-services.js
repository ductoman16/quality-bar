import { createForgejoCommitStatusService } from "./forgejo-commit-status-service.js";
import { createForgejoFeedbackService } from "./forgejo-feedback-service.js";
import { createForgejoWaiverFollowupService } from "./forgejo-waiver-followup-service.js";

/** @param {any} durableCore @param {any} dependencies */
export function createForgejoPublicationServices(durableCore, dependencies) {
  const status = createForgejoCommitStatusService(durableCore, dependencies);
  const feedback = createForgejoFeedbackService(durableCore, dependencies);
  const waiverFollowups = createForgejoWaiverFollowupService(
    durableCore,
    dependencies,
  );
  return {
    async publishWaiting() {
      await status.publishWaiting();
      await feedback.publishWaiting();
      await waiverFollowups.publishWaiting();
    },
    start() {
      status.start();
      feedback.start();
      waiverFollowups.start();
    },
    stop() {
      status.destroy();
      feedback.destroy();
      waiverFollowups.destroy();
    },
  };
}
