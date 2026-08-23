import { delimiter, isAbsolute } from "node:path";

import { validateCodexConfiguration } from "../codex/codex-capabilities.js";

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

/** @param {NodeJS.ProcessEnv} processEnvironment */
export function buildCodexHostEnvironment(processEnvironment) {
  /** @type {Record<string, string>} */
  const environment = {};
  for (const name of CODEX_HOST_ENVIRONMENT) {
    const value = processEnvironment[name];
    if (typeof value === "string" && value.length > 0) {
      environment[name] = value;
    }
  }
  return environment;
}

export class CodexProcessExitError extends Error {
  /**
   * @param {{
   *   code: number | null,
   *   error?: Error,
   *   signal: NodeJS.Signals | null,
   *   stderr: string,
   *   stdout: string
   * }} result
   */
  constructor(result) {
    super("Codex Review Run process exited unsuccessfully");
    this.name = "CodexProcessExitError";
    this.code = result.code;
    this.processError = result.error;
    this.signal = result.signal;
    this.stderr = result.stderr;
    this.stdout = result.stdout;
  }
}

/**
 * @param {unknown} candidate
 * @param {string} [commandDirectory]
 */
export function reviewRunCodexArguments(candidate, commandDirectory) {
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
  const arguments_ = [
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
  if (commandDirectory !== undefined) {
    const executionArgumentIndex = arguments_.indexOf("exec");
    arguments_.splice(
      executionArgumentIndex + 1,
      0,
      "--ephemeral",
      "--add-dir",
      commandDirectory,
      "--disable",
      "code_mode_host",
      "--disable",
      "unified_exec",
      "--disable",
      "apps",
    );
  }
  return arguments_;
}

/**
 * @param {string} commandDirectory
 * @param {NodeJS.ProcessEnv} processEnvironment
 */
export function buildReviewRunCodexEnvironment(
  commandDirectory,
  processEnvironment,
) {
  if (
    typeof commandDirectory !== "string" ||
    !isAbsolute(commandDirectory) ||
    commandDirectory.includes("\0")
  ) {
    throw new TypeError("Review Run submission command directory is invalid");
  }
  const environment = buildCodexHostEnvironment(processEnvironment);
  environment.PATH = environment.PATH
    ? `${commandDirectory}${delimiter}${environment.PATH}`
    : commandDirectory;
  return environment;
}
