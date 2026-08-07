import { closesSubmissionForCancellationOrDeadline } from "./evaluation-cancellation.js";

/**
 * @param {{
 *   channel: {accepted(): boolean, hasCommittedSubmission?(): boolean, hasPendingSubmission?(): boolean, hasPendingAcceptedSubmission?(): boolean, waitForResult(): Promise<"accepted" | "failed">, waitForPendingSubmission?(): Promise<"accepted" | "failed">},
 *   diagnosticFailures: Error[],
 *   stopSubmissionChannel: () => Promise<void>,
 *   terminal: {kind: string, result?: unknown}
 * }} input
 */
export async function settleSubmissionTerminal(input) {
  const failedSubmission =
    input.terminal.kind === "submission" && input.terminal.result === "failed";
  const processError = input.terminal.kind === "process-error";
  const committedSubmission = input.channel.hasCommittedSubmission?.() === true;
  const processHasPendingSubmission =
    input.terminal.kind === "process" &&
    input.channel.hasPendingSubmission?.() === true;
  const processHasRejectedSubmission =
    processHasPendingSubmission &&
    input.channel.hasPendingAcceptedSubmission?.() === false;
  if (
    closesSubmissionForCancellationOrDeadline(input.terminal.kind) ||
    failedSubmission ||
    processError ||
    (input.terminal.kind === "process" && !processHasPendingSubmission) ||
    input.terminal.kind === "transcript"
  ) {
    try {
      await input.stopSubmissionChannel();
    } catch (error) {
      if (input.terminal.kind === "cancellation") {
        input.diagnosticFailures.push(
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
    input.terminal.kind === "submission" &&
    input.terminal.result === "accepted";
  if (committedSubmission) {
    accepted = true;
  }
  if (
    input.terminal.kind === "process" &&
    (input.channel.accepted() || processHasPendingSubmission)
  ) {
    const settledResult = processHasRejectedSubmission
      ? await input.channel.waitForPendingSubmission?.()
      : await input.channel.waitForResult();
    accepted = committedSubmission || settledResult === "accepted";
    if (settledResult !== "accepted") {
      await input.stopSubmissionChannel();
    }
  }
  if (
    input.terminal.kind === "deadline" &&
    !committedSubmission &&
    input.channel.accepted()
  ) {
    accepted = (await input.channel.waitForResult()) === "accepted";
  }
  return { accepted, failedSubmission, processError };
}
