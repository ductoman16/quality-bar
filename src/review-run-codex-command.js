import { delimiter, isAbsolute } from "node:path";

import { validateCodexConfiguration } from "./codex-capabilities.js";

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

export class CodexProcessExitError extends Error {
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
 * @param {NodeJS.ProcessEnv} processEnvironment
 */
export function buildReviewRunCodexEnvironment(
  submissionEnvironment,
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
