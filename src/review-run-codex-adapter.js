import { spawn } from "node:child_process";

import {
  cancelledReviewRunResult,
  closesSubmissionForCancellationOrDeadline,
  NO_REVIEW_RUN_CANCELLATION,
} from "./evaluation-cancellation.js";
import {
  buildReviewRunCodexEnvironment,
  reviewRunCodexArguments,
} from "./review-run-codex-command.js";
import {
  createCodexProcessFailure,
  createSubmissionFailure,
} from "./review-run-codex-failure.js";
import * as deadline from "./review-run-deadline.js";
import { captureEvidenceCompletionFailure } from "./review-run-evidence.js";
import { terminateReviewRunProcessGroup } from "./review-run-process-group.js";
import { ReviewRunExecutionError } from "./review-run-result.js";
import { openReviewRunSubmissionChannel } from "./review-run-submission-channel.js";

const REVIEW_RUN_DEADLINE_MILLISECONDS = 15 * 60 * 1_000;

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new ReviewRunExecutionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

export { reviewRunCodexArguments };

/**
 * @param {Record<string, string>} submissionEnvironment
 * @param {string} commandDirectory
 * @param {NodeJS.ProcessEnv} [processEnvironment]
 */
export function reviewRunCodexEnvironment(
  submissionEnvironment,
  commandDirectory,
  processEnvironment = process.env,
) {
  return buildReviewRunCodexEnvironment(
    submissionEnvironment,
    commandDirectory,
    processEnvironment,
  );
}

/**
 * @param {{
 *   cancellationSignal?: Promise<void>,
 *   checkoutPath: string,
 *   claim: {fencingToken: number, workerId: string, workId: string},
 *   codexCommand?: string,
 *   codexPrefixArguments?: string[],
 *   openSubmissionChannel?: (
 *     claim: any,
 *     resultService: any
 *   ) => Promise<{
 *     accepted(): boolean,
 *     close(): Promise<void>,
 *     commandDirectory: string,
 *     environment: Record<string, string>,
 *     failure(): Error | null,
 *     lastValidationFailure(): ReviewRunExecutionError | null,
 *     waitForResult(): Promise<"accepted" | "failed">
 *   }>,
 *   resultService: {prepare(claim: any, candidate: unknown): unknown},
 *   recordDeadline: (failure: ReviewRunExecutionError) => unknown,
 *   startRun: () => unknown,
 *   run: unknown,
 *   processEnvironment?: NodeJS.ProcessEnv,
 *   clearDeadlineTimer?: (timer: any) => void,
 *   clearTerminationTimer?: (timer: any) => void,
 *   evidenceService?: {
 *     appendTranscriptChunk(claim: any, stream: "stdout" | "stderr", content: string): unknown,
 *     complete(claim: any, facts: unknown): unknown
 *   },
 *   killProcessGroup?: (pid: number, signal: NodeJS.Signals | 0) => void,
 *   setDeadlineTimer?: (callback: () => void, milliseconds: number) => any,
 *   setTerminationTimer?: (callback: () => void, milliseconds: number) => any,
 *   spawnProcess?: (
 *     command: string,
 *     arguments_: string[],
 *     options: import("node:child_process").SpawnOptions
 *   ) => import("node:child_process").ChildProcess
 * }} options
 */
export async function runReviewRunCodex({
  cancellationSignal = NO_REVIEW_RUN_CANCELLATION,
  checkoutPath,
  claim,
  codexCommand = "codex",
  codexPrefixArguments = [],
  clearDeadlineTimer = clearTimeout,
  clearTerminationTimer = clearTimeout,
  evidenceService = {
    appendTranscriptChunk() {},
    complete() {},
  },
  killProcessGroup = process.kill,
  openSubmissionChannel = openReviewRunSubmissionChannel,
  processEnvironment = process.env,
  recordDeadline,
  resultService,
  run,
  setDeadlineTimer = setTimeout,
  setTerminationTimer = setTimeout,
  spawnProcess = spawn,
  startRun,
}) {
  deadline.requireDeadlineRecorder(recordDeadline);
  const channel = await openSubmissionChannel(claim, resultService);
  /** @type {Promise<void> | undefined} */
  let channelClose;
  function closeSubmissionChannel() {
    channelClose ??= channel.close();
    return channelClose;
  }
  let executionFailure;
  /** @type {Error[]} */
  const diagnosticFailures = [];
  try {
    const arguments_ = [
      ...codexPrefixArguments,
      ...reviewRunCodexArguments(run),
    ];
    startRun();
    /** @type {(value?: void) => void} */
    let signalDeadline = () => {};
    const deadlineSignal = new Promise((resolve) => {
      signalDeadline = resolve;
    });
    const deadlineTimer = setDeadlineTimer(
      signalDeadline,
      REVIEW_RUN_DEADLINE_MILLISECONDS,
    );
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawnProcess(codexCommand, arguments_, {
        cwd: checkoutPath,
        detached: true,
        env: reviewRunCodexEnvironment(
          channel.environment,
          channel.commandDirectory,
          processEnvironment,
        ),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      clearDeadlineTimer(deadlineTimer);
      fail(
        "codex_process_failed",
        "Codex Review Run process could not start",
        cause,
      );
    }
    let stdout = "";
    let stderr = "";
    let processClosed = false;
    const processResult = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        processClosed = true;
        resolve({ code, signal, stderr, stdout });
      });
    });
    const terminateProcessGroup = () =>
      terminateReviewRunProcessGroup({
        child,
        processResult,
        killProcessGroup,
        setTerminationTimer,
        clearTerminationTimer,
      });
    /** @type {unknown} */
    let transcriptFailure;
    /** @type {Promise<void> | undefined} */
    let transcriptTermination;
    /** @type {(value: void | PromiseLike<void>) => void} */
    let resolveTranscriptFailure;
    const transcriptFailureSignal = new Promise((resolve) => {
      resolveTranscriptFailure = resolve;
    });
    /** @param {unknown} error */
    function stopAfterTranscriptFailure(error) {
      if (transcriptFailure) {
        return;
      }
      transcriptFailure = error;
      resolveTranscriptFailure(undefined);
      transcriptTermination = terminateProcessGroup().catch(
        (terminationFailure) => {
          const failure =
            terminationFailure instanceof Error
              ? terminationFailure
              : new TypeError("Codex process-group termination failed");
          diagnosticFailures.push(failure);
          if (transcriptFailure instanceof Error) {
            Object.defineProperty(
              transcriptFailure,
              "processTerminationFailure",
              {
                configurable: true,
                enumerable: false,
                value: failure,
              },
            );
          }
        },
      );
    }
    child.stdout?.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      try {
        evidenceService.appendTranscriptChunk(claim, "stdout", chunk);
      } catch (error) {
        stopAfterTranscriptFailure(error);
      }
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
      try {
        evidenceService.appendTranscriptChunk(claim, "stderr", chunk);
      } catch (error) {
        stopAfterTranscriptFailure(error);
      }
    });
    /** @type {{ kind: "cancellation" } | { kind: "deadline" } | { kind: "process", result: any } | { kind: "submission", result: "accepted" | "failed" } | { kind: "transcript" }} */
    let terminal;
    try {
      terminal = await Promise.race([
        cancellationSignal.then(() => ({
          kind: /** @type {const} */ ("cancellation"),
        })),
        processResult.then((result) => ({
          kind: /** @type {const} */ ("process"),
          result,
        })),
        channel.waitForResult().then((result) => ({
          kind: /** @type {const} */ ("submission"),
          result,
        })),
        transcriptFailureSignal.then(() => ({
          kind: /** @type {const} */ ("transcript"),
        })),
        deadlineSignal.then(() => ({
          kind: /** @type {const} */ ("deadline"),
        })),
      ]).catch((cause) =>
        fail(
          "codex_process_failed",
          "Codex Review Run process could not start",
          cause,
        ),
      );
    } finally {
      clearDeadlineTimer(deadlineTimer);
    }
    if (closesSubmissionForCancellationOrDeadline(terminal.kind)) {
      try {
        await closeSubmissionChannel();
      } catch (error) {
        // The durable terminal transition remains authoritative. Final cleanup
        // preserves its exact submission-channel failure where applicable.
        if (terminal.kind === "cancellation") {
          diagnosticFailures.push(
            error instanceof Error
              ? error
              : new TypeError("Review Run submission channel cleanup failed", {
                  cause: error,
                }),
          );
        }
      }
    }
    let accepted =
      terminal.kind === "submission" && terminal.result === "accepted";
    if (terminal.kind === "process" && channel.accepted()) {
      accepted = (await channel.waitForResult()) === "accepted";
    }
    if (terminal.kind === "deadline" && channel.accepted()) {
      accepted = (await channel.waitForResult()) === "accepted";
    }
    const deadlineFailure = deadline.createDeadlineFailure(
      terminal.kind === "deadline",
      accepted,
    );
    const deadlineRecordingFailure = deadline.captureDeadlineRecordingFailure(
      recordDeadline,
      deadlineFailure,
    );
    /** @type {Error | undefined} */
    let acceptedTerminationFailure;
    if (
      (accepted || closesSubmissionForCancellationOrDeadline(terminal.kind)) &&
      !transcriptTermination
    ) {
      try {
        await terminateProcessGroup();
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new TypeError("Codex process-group termination failed", {
                cause: error,
              });
        if (processClosed && terminal.kind !== "deadline") {
          diagnosticFailures.push(failure);
        } else {
          acceptedTerminationFailure = failure;
        }
      }
    }
    await transcriptTermination;
    if (transcriptFailure && !deadlineFailure) {
      throw transcriptFailure;
    }
    if (acceptedTerminationFailure) {
      if (deadlineFailure) {
        const failure =
          acceptedTerminationFailure instanceof Error
            ? acceptedTerminationFailure
            : new TypeError("Codex process-group termination failed");
        const owningFailure =
          deadlineRecordingFailure instanceof Error
            ? deadlineRecordingFailure
            : deadlineFailure;
        Object.defineProperty(owningFailure, "processTerminationFailure", {
          configurable: true,
          enumerable: false,
          value: failure,
        });
        throw owningFailure;
      }
      fail(
        "codex_process_failed",
        "Codex Review Run process-group termination failed",
        acceptedTerminationFailure,
      );
    }
    const terminalProcess =
      terminal.kind === "process" ? terminal.result : await processResult;
    const evidenceCompletionFailure = captureEvidenceCompletionFailure(
      evidenceService,
      claim,
      terminalProcess,
      stdout,
    );
    const submissionFailure = channel.failure();
    const cancellationResult = cancelledReviewRunResult(
      terminal.kind,
      evidenceCompletionFailure,
      submissionFailure,
      diagnosticFailures,
    );
    if (cancellationResult) {
      return cancellationResult;
    }
    if (deadlineFailure) {
      throw deadline.attachDeadlineCleanupFailures(
        deadlineFailure,
        deadlineRecordingFailure,
        { evidenceCompletionFailure, submissionFailure, transcriptFailure },
      );
    }
    if (evidenceCompletionFailure) {
      throw evidenceCompletionFailure;
    }
    if (submissionFailure) {
      throw createSubmissionFailure(submissionFailure);
    }
    if (terminal.kind === "submission" && terminal.result === "failed") {
      throw createSubmissionFailure(
        new TypeError("Review Run submission failed"),
      );
    }
    if (terminal.kind === "process" && !channel.accepted()) {
      const exit = /** @type {any} */ (terminal.result);
      const validationFailure = channel.lastValidationFailure();
      if (validationFailure || (exit.code === 0 && exit.signal === null)) {
        fail(
          "result_not_submitted",
          validationFailure
            ? `Codex Review Run exited without an accepted Result; last validation error ${validationFailure.code}: ${validationFailure.message}`
            : "Codex Review Run exited without an accepted Result",
        );
      }
      throw createCodexProcessFailure(exit, channel.environment);
    }
  } catch (error) {
    executionFailure = error;
  }
  let cleanupFailure;
  try {
    await closeSubmissionChannel();
  } catch (error) {
    cleanupFailure = error;
  }
  if (executionFailure instanceof Error) {
    if (cleanupFailure) {
      Object.defineProperty(
        executionFailure,
        "submissionChannelCleanupFailure",
        {
          configurable: true,
          enumerable: false,
          value: cleanupFailure,
        },
      );
    }
    throw executionFailure;
  }
  if (cleanupFailure) {
    diagnosticFailures.push(
      cleanupFailure instanceof Error
        ? cleanupFailure
        : new TypeError("Review Run submission channel cleanup failed"),
    );
  }
  return { diagnosticFailures };
}
