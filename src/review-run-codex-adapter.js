import { spawn } from "node:child_process";

import {
  observeSupervisedCodexProcess,
  prepareCodexProcess,
} from "./codex-process-supervisor.js";
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
  attachFailureDiagnostic as attachDiagnostic,
  createCodexProcessFailure,
  createSubmissionFailure,
} from "./review-run-codex-failure.js";
import {
  completeCodexExecutionCleanup,
  createCodexLaunchFailure,
  createSubmissionChannelControllers,
  createTranscriptFailureController,
} from "./review-run-codex-process.js";
import * as group from "./codex-execution-process-group-tracking.js";
import * as deadline from "./review-run-deadline.js";
import * as evidence from "./review-run-evidence.js";
import { createReviewRunProcessGroupTermination } from "./review-run-process-group.js";
import { ReviewRunExecutionError } from "./review-run-result.js";
import { settleSubmissionTerminal } from "./review-run-codex-submission-terminal.js";
import { openReviewRunSubmissionChannel } from "./review-run-submission-channel.js";

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

/** @param {import("./review-run-codex-options.js").ReviewRunCodexOptions} options */
export async function runReviewRunCodex({
  cancellationSignal = NO_REVIEW_RUN_CANCELLATION,
  checkoutPath,
  claim,
  codexCommand = "codex",
  codexPrefixArguments = [],
  clearDeadlineTimer = clearTimeout,
  clearTerminationTimer = clearTimeout,
  evidenceService = evidence.NO_REVIEW_RUN_EVIDENCE,
  killProcessGroup = process.kill,
  openSubmissionChannel: openChannel = openReviewRunSubmissionChannel,
  observeProcess = observeSupervisedCodexProcess,
  prepareProcess = prepareCodexProcess,
  processEnvironment = process.env,
  recordDeadline,
  resultService,
  run,
  submissionMode = "review-file",
  setDeadlineTimer = setTimeout,
  setTerminationTimer = setTimeout,
  spawnProcess = spawn,
  startProcessGroup,
  finishProcessGroup,
}) {
  deadline.requireDeadlineRecorder(recordDeadline);
  group.requireTracking(finishProcessGroup, startProcessGroup);
  const channel = await openChannel(claim, resultService, {
    checkoutPath,
    submissionMode,
  });
  const { close: closeSubmissionChannel, stop: stopSubmissionChannel } =
    createSubmissionChannelControllers(channel);
  /** @type {Error[]} */
  const diagnosticFailures = [];
  let executionFailure;
  try {
    const arguments_ = reviewRunCodexArguments(run);
    arguments_.unshift(...codexPrefixArguments);
    /** @type {(value?: void) => void} */
    let signalDeadline = () => {};
    const deadlineSignal = new Promise((resolve) => {
      signalDeadline = resolve;
    });
    const deadlineTimer = setDeadlineTimer(
      signalDeadline,
      deadline.REVIEW_RUN_DEADLINE_MILLISECONDS,
    );
    /** @type {{abort: () => Promise<void>, child: import("node:child_process").ChildProcess, finish: () => Promise<void>, start: () => Promise<void>}} */
    let prepared;
    try {
      prepared = prepareProcess(
        codexCommand,
        arguments_,
        {
          cwd: checkoutPath,
          environment: reviewRunCodexEnvironment(
            channel.environment,
            channel.commandDirectory,
            processEnvironment,
          ),
        },
        process.execPath,
        spawnProcess,
      );
    } catch (cause) {
      clearDeadlineTimer(deadlineTimer);
      throw createCodexLaunchFailure({
        cause,
        claim,
        environment: channel.environment,
        evidenceService,
      });
    }
    const { child } = prepared;
    let [stdout, stderr] = ["", ""];
    const {
      error: processErrorSignal,
      result: processResult,
      wasClosed,
    } = observeProcess(child, () => ({ stderr, stdout }));
    const terminateProcessGroup = createReviewRunProcessGroupTermination({
      child,
      processResult,
      killProcessGroup,
      setTerminationTimer,
      clearTerminationTimer,
      finishSupervisor: prepared.finish,
    });
    const transcript = createTranscriptFailureController({
      closeSubmissionChannel: stopSubmissionChannel,
      diagnosticFailures,
      terminateProcessGroup,
    });
    child.stdout
      ?.setEncoding("utf8")
      .on("data", (/** @type {string} */ chunk) => {
        stdout += chunk;
        try {
          evidenceService.appendTranscriptChunk(claim, "stdout", chunk);
        } catch (error) {
          transcript.stop(error);
        }
      });
    child.stderr
      ?.setEncoding("utf8")
      .on("data", (/** @type {string} */ chunk) => {
        stderr += chunk;
        try {
          evidenceService.appendTranscriptChunk(claim, "stderr", chunk);
        } catch (error) {
          transcript.stop(error);
        }
      });
    try {
      await group.startSpawnedCodexProcessGroup(
        child,
        startProcessGroup,
        prepared.start,
        stopSubmissionChannel,
        prepared.abort,
      );
      channel.bindProcessGroup(/** @type {number} */ (child.pid));
    } catch (error) {
      clearDeadlineTimer(deadlineTimer);
      throw error;
    }
    /** @type {{ kind: "cancellation" } | { kind: "deadline" } | { kind: "process", result: any } | { kind: "process-error" } | { kind: "submission", result: "accepted" | "failed" } | { kind: "transcript" }} */
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
        processErrorSignal.then(() => ({
          kind: /** @type {const} */ ("process-error"),
        })),
        channel.waitForResult().then((result) => ({
          kind: /** @type {const} */ ("submission"),
          result,
        })),
        transcript.signal.then(() => ({
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
    const { accepted, failedSubmission, processError } =
      await settleSubmissionTerminal({
        channel,
        diagnosticFailures,
        stopSubmissionChannel,
        terminal,
      });
    const committedSubmission = channel.hasCommittedSubmission?.() === true;
    const deadlineFailure = deadline.createDeadlineFailure(
      terminal.kind === "deadline",
      accepted,
    );
    const deadlineRecordingFailure = deadline.captureDeadlineRecordingFailure(
      recordDeadline,
      deadlineFailure,
    );
    /** @type {Error | undefined} */ let acceptedTerminationFailure;
    /** @type {Error | undefined} */ let submissionTerminationFailure;
    /** @type {Error | undefined} */ let processErrorTerminationFailure;
    if (
      (accepted ||
        failedSubmission ||
        processError ||
        terminal.kind === "process" ||
        closesSubmissionForCancellationOrDeadline(terminal.kind)) &&
      !transcript.termination()
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
        if (processError) {
          processErrorTerminationFailure = failure;
        } else if (failedSubmission && wasClosed()) {
          submissionTerminationFailure = failure;
        } else if (wasClosed() && terminal.kind !== "deadline") {
          diagnosticFailures.push(failure);
        } else {
          acceptedTerminationFailure = failure;
        }
      }
    }
    await transcript.termination();
    const transcriptFailure = transcript.failure();
    if (transcriptFailure && terminal.kind === "cancellation") {
      diagnosticFailures.push(
        transcriptFailure instanceof Error
          ? transcriptFailure
          : new TypeError("Review Run transcript persistence failed", {
              cause: transcriptFailure,
            }),
      );
    } else if (transcriptFailure && !deadlineFailure && !failedSubmission) {
      throw transcriptFailure;
    }
    if (acceptedTerminationFailure) {
      if (committedSubmission) {
        diagnosticFailures.push(acceptedTerminationFailure);
      } else if (failedSubmission) {
        const owningFailure = createSubmissionFailure(
          channel.failure() ?? new TypeError("Review Run submission failed"),
        );
        attachDiagnostic(
          owningFailure,
          "processTerminationFailure",
          acceptedTerminationFailure,
        );
        throw owningFailure;
      } else if (deadlineFailure) {
        const owningFailure =
          deadlineRecordingFailure instanceof Error
            ? deadlineRecordingFailure
            : deadlineFailure;
        attachDiagnostic(
          owningFailure,
          "processTerminationFailure",
          acceptedTerminationFailure,
        );
        throw owningFailure;
      } else {
        fail(
          "codex_process_failed",
          "Codex Review Run process-group termination failed",
          acceptedTerminationFailure,
        );
      }
    }
    if (processErrorTerminationFailure && committedSubmission) {
      diagnosticFailures.push(processErrorTerminationFailure);
    }
    const terminalProcess =
      terminal.kind === "process" ? terminal.result : await processResult;
    finishProcessGroup();
    const evidenceCompletionFailure = evidence.captureEvidenceCompletionFailure(
      evidenceService,
      claim,
      terminalProcess,
      stdout,
    );
    const submissionFailure = channel.failure();
    if (accepted && submissionFailure) {
      diagnosticFailures.push(
        submissionFailure instanceof Error
          ? submissionFailure
          : new TypeError("Review Run submission channel cleanup failed", {
              cause: submissionFailure,
            }),
      );
    }
    const cancellationResult = accepted
      ? undefined
      : cancelledReviewRunResult(
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
    if (
      !committedSubmission &&
      ((!accepted && submissionFailure) || failedSubmission)
    ) {
      const owningFailure = createSubmissionFailure(
        submissionFailure ?? new TypeError("Review Run submission failed"),
      );
      if (evidenceCompletionFailure) {
        attachDiagnostic(
          owningFailure,
          "evidenceCompletionFailure",
          evidenceCompletionFailure,
        );
      }
      if (transcriptFailure) {
        attachDiagnostic(owningFailure, "transcriptFailure", transcriptFailure);
      }
      if (submissionTerminationFailure) {
        attachDiagnostic(
          owningFailure,
          "processTerminationFailure",
          submissionTerminationFailure,
        );
      }
      throw owningFailure;
    }
    if (evidenceCompletionFailure) {
      throw evidenceCompletionFailure;
    }
    if ((terminal.kind === "process" || processError) && !accepted) {
      const exit = /** @type {any} */ (terminalProcess);
      const validationFailure = channel.lastValidationFailure();
      if (validationFailure || (exit.code === 0 && exit.signal === null)) {
        fail(
          "result_not_submitted",
          validationFailure
            ? `Codex Review Run exited without an accepted Result; last validation error ${validationFailure.code}: ${validationFailure.message}`
            : "Codex Review Run exited without an accepted Result",
        );
      }
      const failure = createCodexProcessFailure(exit, channel.environment);
      if (processErrorTerminationFailure) {
        attachDiagnostic(
          failure,
          "processTerminationFailure",
          processErrorTerminationFailure,
        );
      }
      throw failure;
    }
  } catch (error) {
    executionFailure = error;
  }
  return completeCodexExecutionCleanup(
    closeSubmissionChannel,
    executionFailure,
    diagnosticFailures,
  );
}
