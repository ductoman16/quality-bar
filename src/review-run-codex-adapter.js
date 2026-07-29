import { spawn } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import { readTerminalTokenCounters } from "./review-run-evidence.js";
import { terminateReviewRunProcessGroup } from "./review-run-process-group.js";
import { ReviewRunExecutionError } from "./review-run-result.js";
import { openReviewRunSubmissionChannel } from "./review-run-submission-channel.js";

const CODEX_HOST_ENVIRONMENT = Object.freeze([
  "CODEX_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "XDG_CONFIG_HOME",
]);
const REVIEW_RUN_DEADLINE_MILLISECONDS = 15 * 60 * 1_000;

class CodexProcessExitError extends Error {
  /**
   * @param {{
   *   code: number | null,
   *   signal: NodeJS.Signals | null,
   *   stderr: string,
   *   stdout: string
   * }} result
   */
  constructor(result) {
    super("Codex Review Run process exited unsuccessfully");
    this.name = "CodexProcessExitError";
    this.code = result.code;
    this.signal = result.signal;
    this.stderr = result.stderr;
    this.stdout = result.stdout;
  }
}

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

/** @param {unknown} candidate */
export function reviewRunCodexArguments(candidate) {
  const input = /** @type {any} */ (candidate);
  const configuration = validateCodexConfiguration(input?.configuration);
  if (
    typeof input?.prompt !== "string" ||
    input.prompt.length === 0 ||
    !Array.isArray(input.criteria) ||
    input.criteria.length === 0
  ) {
    throw new TypeError("Review Run Codex input is invalid");
  }
  return [
    "--model",
    configuration.model,
    "--config",
    `model_reasoning_effort="${configuration.reasoning_effort}"`,
    "--config",
    `service_tier="${configuration.service_tier}"`,
    "--config",
    "project_doc_max_bytes=0",
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "--sandbox",
    "workspace-write",
    "--config",
    'approval_policy="never"',
    "--config",
    "sandbox_workspace_write.network_access=false",
    "--config",
    "shell_environment_policy.ignore_default_excludes=true",
    "--config",
    "allow_login_shell=false",
    input.prompt,
  ];
}

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
  if (
    typeof commandDirectory !== "string" ||
    !isAbsolute(commandDirectory) ||
    commandDirectory.includes("\0")
  ) {
    throw new TypeError("Review Run submission command directory is invalid");
  }
  /** @type {Record<string, string>} */
  const environment = {};
  for (const name of CODEX_HOST_ENVIRONMENT) {
    const value = processEnvironment[name];
    if (typeof value === "string" && value.length > 0) {
      environment[name] = value;
    }
  }
  environment.PATH = environment.PATH
    ? `${commandDirectory}${delimiter}${environment.PATH}`
    : commandDirectory;
  return { ...environment, ...submissionEnvironment };
}

/**
 * @param {{
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
  resultService,
  run,
  setDeadlineTimer = setTimeout,
  setTerminationTimer = setTimeout,
  spawnProcess = spawn,
  startRun,
}) {
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
      transcriptTermination = terminateReviewRunProcessGroup(
        child,
        processResult,
        killProcessGroup,
        setTerminationTimer,
        clearTerminationTimer,
      ).catch((terminationFailure) => {
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
      });
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
    /** @type {{ kind: "deadline" } | { kind: "process", result: any } | { kind: "submission", result: "accepted" | "failed" } | { kind: "transcript" }} */
    let terminal;
    try {
      terminal = await Promise.race([
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
    if (terminal.kind === "deadline") {
      try {
        await closeSubmissionChannel();
      } catch {
        // The deadline remains authoritative; final cleanup preserves the
        // exact submission-channel failure on that owning error.
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
    /** @type {Error | undefined} */
    let acceptedTerminationFailure;
    if ((accepted || terminal.kind === "deadline") && !transcriptTermination) {
      try {
        await terminateReviewRunProcessGroup(
          child,
          processResult,
          killProcessGroup,
          setTerminationTimer,
          clearTerminationTimer,
        );
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new TypeError("Codex process-group termination failed");
        if (processClosed && terminal.kind !== "deadline") {
          diagnosticFailures.push(failure);
        } else {
          acceptedTerminationFailure = failure;
        }
      }
    }
    await transcriptTermination;
    if (transcriptFailure) {
      throw transcriptFailure;
    }
    if (acceptedTerminationFailure) {
      fail(
        "codex_process_failed",
        "Codex Review Run process-group termination failed",
        acceptedTerminationFailure,
      );
    }
    const terminalProcess =
      terminal.kind === "process" ? terminal.result : await processResult;
    evidenceService.complete(claim, {
      exitCode: terminalProcess?.code ?? null,
      signal: terminalProcess?.signal ?? null,
      tokenCounters: readTerminalTokenCounters(stdout),
    });
    const submissionFailure = channel.failure();
    if (submissionFailure) {
      throw submissionFailure;
    }
    if (terminal.kind === "submission" && terminal.result === "failed") {
      throw new TypeError("Review Run submission failed");
    }
    if (terminal.kind === "deadline" && !accepted) {
      fail(
        "deadline_exceeded",
        "Codex Review Run exceeded its 15-minute deadline",
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
      fail(
        "codex_process_failed",
        "Codex Review Run process failed",
        new CodexProcessExitError(exit),
      );
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
