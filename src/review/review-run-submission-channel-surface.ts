import {
  cleanupOwnedDirectory,
  cleanupOwnedFile,
  cleanupSubmissionFiles,
  drainSubmissionArtifacts,
  mergeCleanupFailure,
} from "./review-run-submission-cleanup.ts";

export function createSubmissionChannelSurface(input: any) {
  return {
    accepted: () => input.state.accepted,
    bindProcessGroup: input.bindProcessGroup,
    hasCommittedSubmission: () => input.state.committed,
    commandDirectory: input.directory,
    environment: {
      QUALITY_BAR_SUBMIT_FILE: input.endpointName,
      QUALITY_BAR_SUBMIT_TOKEN: input.token,
    },
    failure: () => input.unexpectedFailure(),
    lastValidationFailure: () => input.state.lastValidationFailure,
    hasPendingSubmission: () => input.state.pendingResponse !== null,
    hasPendingAcceptedSubmission: () =>
      input.state.pendingResponse?.accepted === true,
    waitForResult: () => input.result,
    waitForPendingSubmission: () => input.pendingSettlement(),
    stop: async () => {
      input.stopAccepting();
    },
    async close() {
      input.stopAccepting();
      let closeFailure: unknown = input.stopFailure();
      const drained = await drainSubmissionArtifacts(
        input.paths,
        input.identities,
        closeFailure,
        input.removeOwnedFile,
      );
      closeFailure = drained.failure;
      if (!drained.drained) {
        closeFailure = mergeCleanupFailure(
          closeFailure,
          new Error("Review Run submission channel did not drain"),
        );
      } else {
        closeFailure = cleanupSubmissionFiles(
          input.paths,
          input.identities,
          closeFailure,
          input.removeOwnedFile,
        );
      }
      for (const [path, identity] of [
        [input.commandPath, input.installation.commandIdentity],
        [input.runtimePath, input.installation.runtimeIdentity],
        [input.installation.tokenPath, input.installation.tokenIdentity],
        [
          input.installation.trustedProcessPath,
          input.installation.trustedProcessIdentity,
        ],
      ]) {
        closeFailure = cleanupOwnedFile(
          path,
          identity,
          closeFailure,
          input.removeOwnedFile,
        );
      }
      closeFailure = cleanupOwnedDirectory(
        input.directory,
        input.directoryIdentity,
        closeFailure,
        input.removeDirectory,
      );
      if (closeFailure !== null) {
        throw closeFailure;
      }
    },
  };
}
