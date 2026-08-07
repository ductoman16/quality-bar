import {
  attachFailureDiagnostic,
  createCodexProcessFailure,
} from "./review-run-codex-failure.js";
import { captureEvidenceCompletionFailure } from "./review-run-evidence.js";

/**
 * @param {{
 *   cause: unknown,
 *   claim: unknown,
 *   environment: Record<string, string>,
 *   evidenceService: {complete: (claim: any, facts: any) => unknown},
 * }} input
 */
export function createCodexLaunchFailure({
  cause,
  claim,
  environment,
  evidenceService,
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

/**
 * @param {{close: () => Promise<void>, stop?: () => Promise<void>}} channel
 */
export function createSubmissionChannelControllers(channel) {
  /** @type {Promise<void> | undefined} */
  let channelClose;
  /** @type {Promise<void> | undefined} */
  let channelStop;
  const stop = () =>
    (channelStop ??= channel.stop ? channel.stop() : channel.close());
  const close = () =>
    (channelClose ??= channel.stop
      ? channel.close()
      : (channelStop ??= channel.close()));
  return { close, stop };
}

/**
 * @param {{
 *   closeSubmissionChannel: () => Promise<void>,
 *   diagnosticFailures: Error[],
 *   terminateProcessGroup: () => Promise<void>,
 * }} input
 */
export function createTranscriptFailureController({
  closeSubmissionChannel,
  diagnosticFailures,
  terminateProcessGroup,
}) {
  let stopped = false;
  /** @type {unknown} */
  let failure;
  /** @type {Promise<void> | undefined} */
  let termination;
  /** @type {(value: void | PromiseLike<void>) => void} */
  let signalFailure;
  const signal = new Promise((resolve) => {
    signalFailure = resolve;
  });
  return {
    failure: () => failure,
    signal,
    /** @param {unknown} error */
    stop(error) {
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

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {() => {stderr: string, stdout: string}} readTranscript
 */
export function observeCodexProcess(child, readTranscript) {
  let closed = false;
  /** @type {Error | undefined} */
  let processError;
  /** @type {(error: Error) => void} */
  let signalProcessError;
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

/**
 * @param {() => Promise<void>} closeSubmissionChannel
 * @param {unknown} executionFailure
 * @param {Error[]} diagnosticFailures
 */
export async function completeCodexExecutionCleanup(
  closeSubmissionChannel,
  executionFailure,
  diagnosticFailures,
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
