import {
  attachFailureDiagnostic,
  createCodexProcessFailure,
} from "./review-run-codex-failure.ts";
import { captureEvidenceCompletionFailure } from "./review-run-evidence.ts";

export function createCodexLaunchFailure({
  cause,
  claim,
  environment,
  evidenceService,
}: {
  cause: unknown;
  claim: unknown;
  environment: Record<string, string>;
  evidenceService: { complete: (claim: any, facts: any) => unknown };
}) {
  const processError =
    cause instanceof Error
      ? cause
      : new TypeError("Codex Review Run process could not start", { cause });
  const failedProcess = {
    code: null,
    error: processError,
    signal: null,
    stderr: "",
    stdout: "",
  };
  const failure = createCodexProcessFailure(failedProcess, environment);
  const evidenceFailure = captureEvidenceCompletionFailure(
    evidenceService,
    claim,
    failedProcess,
    "",
  );
  if (evidenceFailure) {
    attachFailureDiagnostic(
      failure,
      "evidenceCompletionFailure",
      evidenceFailure,
    );
  }
  return failure;
}

export function createSubmissionChannelControllers(channel: {
  close: () => Promise<void>;
  stop?: () => Promise<void>;
}) {
  let channelClose: Promise<void> | undefined;
  let channelStop: Promise<void> | undefined;
  const stop = () =>
    (channelStop ??= channel.stop ? channel.stop() : channel.close());
  const close = () =>
    (channelClose ??= channel.stop
      ? channel.close()
      : (channelStop ??= channel.close()));
  return { close, stop };
}

export function createTranscriptFailureController({
  closeSubmissionChannel,
  diagnosticFailures,
  terminateProcessGroup,
}: {
  closeSubmissionChannel: () => Promise<void>;
  diagnosticFailures: Error[];
  terminateProcessGroup: () => Promise<void>;
}) {
  let stopped = false;
  let failure: unknown;
  let termination: Promise<void> | undefined;
  let signalFailure: (value: void | PromiseLike<void>) => void;
  const signal = new Promise((resolve) => {
    signalFailure = resolve;
  });
  return {
    failure: () => failure,
    signal,
    stop(error: unknown) {
      if (stopped) {
        return;
      }
      stopped = true;
      failure =
        error instanceof Error
          ? error
          : new TypeError("Review Run transcript persistence failed", {
              cause: error,
            });
      signalFailure(undefined);
      termination = (async () => {
        try {
          await closeSubmissionChannel();
        } catch (submissionCloseFailure) {
          if (failure instanceof Error) {
            attachFailureDiagnostic(
              failure,
              "submissionChannelCleanupFailure",
              submissionCloseFailure,
            );
          }
        }
        try {
          await terminateProcessGroup();
        } catch (terminationFailure) {
          const diagnostic =
            terminationFailure instanceof Error
              ? terminationFailure
              : new TypeError("Codex process-group termination failed");
          diagnosticFailures.push(diagnostic);
          if (failure instanceof Error) {
            attachFailureDiagnostic(
              failure,
              "processTerminationFailure",
              diagnostic,
            );
          }
        }
      })();
    },
    termination: () => termination,
  };
}

export function observeCodexProcess(
  child: import("node:child_process").ChildProcess,
  readTranscript: () => { stderr: string; stdout: string },
) {
  let closed = false;
  let processError: Error | undefined;
  let signalProcessError: (error: Error) => void;
  const error = new Promise((resolve) => {
    signalProcessError = resolve;
  });
  const result = new Promise((resolve) => {
    child.once("error", (failure) => {
      processError =
        failure instanceof Error
          ? failure
          : new TypeError("Codex Review Run process failed", {
              cause: failure,
            });
      signalProcessError(processError);
    });
    child.once("close", (code, signal) => {
      closed = true;
      resolve({
        code,
        error: processError,
        signal,
        ...readTranscript(),
      });
    });
  });
  return {
    error,
    result,
    wasClosed: () => closed,
  };
}

export async function completeCodexExecutionCleanup(
  closeSubmissionChannel: () => Promise<void>,
  executionFailure: unknown,
  diagnosticFailures: Error[],
) {
  let cleanupFailure;
  let cleanupFailed = false;
  try {
    await closeSubmissionChannel();
  } catch (error) {
    cleanupFailure = error;
    cleanupFailed = true;
  }
  if (executionFailure instanceof Error) {
    if (cleanupFailed) {
      attachFailureDiagnostic(
        executionFailure,
        "submissionChannelCleanupFailure",
        cleanupFailure instanceof Error
          ? cleanupFailure
          : new TypeError("Review Run submission channel cleanup failed", {
              cause: cleanupFailure,
            }),
      );
    }
    throw executionFailure;
  }
  if (cleanupFailed) {
    diagnosticFailures.push(
      cleanupFailure instanceof Error
        ? cleanupFailure
        : new TypeError("Review Run submission channel cleanup failed", {
            cause: cleanupFailure,
          }),
    );
  }
  return { diagnosticFailures };
}
