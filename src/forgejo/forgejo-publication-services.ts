import { createForgejoCommitStatusService } from "./forgejo-commit-status-service.ts";
import { createForgejoFeedbackService } from "./forgejo-feedback-service.ts";
import { createForgejoWaiverFollowupService } from "./forgejo-waiver-followup-service.ts";

export function createForgejoPublicationServices(
  durableCore: any,
  dependencies: any,
) {
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
