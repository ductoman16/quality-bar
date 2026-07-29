import { spawn } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";

import { validateCodexConfiguration } from "./codex-capabilities.js";
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
 *     failure(): Error | null
 *   }>,
 *   resultService: {submit(claim: any, candidate: unknown): unknown},
 *   run: unknown,
 *   processEnvironment?: NodeJS.ProcessEnv,
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
  openSubmissionChannel = openReviewRunSubmissionChannel,
  processEnvironment = process.env,
  resultService,
  run,
  spawnProcess = spawn,
}) {
  const channel = await openSubmissionChannel(claim, resultService);
  try {
    const arguments_ = [
      ...codexPrefixArguments,
      ...reviewRunCodexArguments(run),
    ];
    const result = await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(codexCommand, arguments_, {
          cwd: checkoutPath,
          env: reviewRunCodexEnvironment(
            channel.environment,
            channel.commandDirectory,
            processEnvironment,
          ),
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({ code, signal, stderr, stdout });
      });
    }).catch((cause) =>
      fail(
        "codex_process_failed",
        "Codex Review Run process could not start",
        cause,
      ),
    );
    const submissionFailure = channel.failure();
    if (submissionFailure) {
      throw submissionFailure;
    }
    if (!channel.accepted()) {
      const processResult = /** @type {any} */ (result);
      if (processResult.code === 0 && processResult.signal === null) {
        fail(
          "result_not_submitted",
          "Codex Review Run exited without an accepted Result",
        );
      }
      fail(
        "codex_process_failed",
        "Codex Review Run process failed",
        new CodexProcessExitError(processResult),
      );
    }
  } finally {
    await channel.close();
  }
}
