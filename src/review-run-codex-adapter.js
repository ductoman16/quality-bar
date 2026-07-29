import { spawn } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import { readTerminalTokenCounters } from "./review-run-evidence.js";
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

/** @param {unknown} error */
function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/** @param {unknown} error */
function isPermissionDenied(error) {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {Promise<unknown>} processResult
 * @param {(pid: number, signal: NodeJS.Signals | 0) => void} killProcessGroup
 * @param {(callback: () => void, milliseconds: number) => any} setTerminationTimer
 * @param {(timer: any) => void} clearTerminationTimer
 */
async function terminateCodexProcessGroup(
  child,
  processResult,
  killProcessGroup,
  setTerminationTimer,
  clearTerminationTimer,
) {
  if (
    !Number.isSafeInteger(child.pid) ||
    /** @type {number} */ (child.pid) < 1
  ) {
    throw new TypeError("Codex Review Run process identity is unavailable");
  }
  const processGroupId = -(/** @type {number} */ (child.pid));
  try {
    killProcessGroup(processGroupId, "SIGTERM");
  } catch (error) {
    if (isMissingProcess(error)) {
      return;
    }
    throw error;
  }
  /** @type {any} */
  let terminationTimer;
  const forceKill = new Promise((resolve, reject) => {
    terminationTimer = setTerminationTimer(() => {
      try {
        killProcessGroup(processGroupId, "SIGKILL");
        resolve(undefined);
      } catch (error) {
        if (isMissingProcess(error)) {
          resolve(undefined);
        } else {
          reject(error);
        }
      }
    }, 5_000);
  });
  try {
    const first = await Promise.race([
      processResult.then(() => "process"),
      forceKill.then(() => "force-kill"),
    ]);
    if (first === "process") {
      try {
        killProcessGroup(processGroupId, 0);
      } catch (error) {
        if (isMissingProcess(error)) {
          return;
        }
        if (isPermissionDenied(error)) {
          await forceKill;
        }
        throw error;
      }
      await forceKill;
    }
  } finally {
    clearTerminationTimer(terminationTimer);
  }
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
 *   resultService: {
 *     prepare(claim: any, candidate: unknown): unknown,
 *     submitPrepared(claim: any): unknown
 *   },
 *   startRun: () => unknown,
 *   run: unknown,
 *   processEnvironment?: NodeJS.ProcessEnv,
 *   clearTerminationTimer?: (timer: any) => void,
 *   evidenceService?: {
 *     appendTranscriptChunk(claim: any, stream: "stdout" | "stderr", content: string): unknown,
 *     complete(claim: any, facts: unknown): unknown
 *   },
 *   killProcessGroup?: (pid: number, signal: NodeJS.Signals | 0) => void,
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
  setTerminationTimer = setTimeout,
  spawnProcess = spawn,
  startRun,
}) {
  const channel = await openSubmissionChannel(claim, resultService);
  let executionFailure;
  /** @type {Error[]} */
  const diagnosticFailures = [];
  try {
    const arguments_ = [
      ...codexPrefixArguments,
      ...reviewRunCodexArguments(run),
    ];
    startRun();
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
      fail(
        "codex_process_failed",
        "Codex Review Run process could not start",
        cause,
      );
    }
    let stdout = "";
    let stderr = "";
    const processResult = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal, stderr, stdout });
      });
    });
    /** @type {unknown} */
    let transcriptFailure;
    /** @type {Promise<void> | undefined} */
    let transcriptTermination;
    /** @param {unknown} error */
    function stopAfterTranscriptFailure(error) {
      if (transcriptFailure) {
        return;
      }
      transcriptFailure = error;
      transcriptTermination = terminateCodexProcessGroup(
        child,
        processResult,
        killProcessGroup,
        setTerminationTimer,
        clearTerminationTimer,
      ).catch((terminationFailure) => {
        diagnosticFailures.push(
          terminationFailure instanceof Error
            ? terminationFailure
            : new TypeError("Codex process-group termination failed"),
        );
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
    const terminal = await Promise.race([
      processResult.then((result) => ({ kind: "process", result })),
      channel.waitForResult().then((result) => ({
        kind: "submission",
        result,
      })),
    ]).catch((cause) =>
      fail(
        "codex_process_failed",
        "Codex Review Run process could not start",
        cause,
      ),
    );
    let accepted =
      terminal.kind === "submission" && terminal.result === "accepted";
    if (terminal.kind === "process" && channel.accepted()) {
      accepted = (await channel.waitForResult()) === "accepted";
    }
    if (accepted && !transcriptTermination) {
      try {
        await terminateCodexProcessGroup(
          child,
          processResult,
          killProcessGroup,
          setTerminationTimer,
          clearTerminationTimer,
        );
      } catch (error) {
        diagnosticFailures.push(
          error instanceof Error
            ? error
            : new TypeError("Codex process-group termination failed"),
        );
      }
    }
    await transcriptTermination;
    if (transcriptFailure) {
      throw transcriptFailure;
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
    if (accepted) {
      resultService.submitPrepared(claim);
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
    await channel.close();
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
