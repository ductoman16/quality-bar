import { ReviewRunExecutionError } from "./review-run-result.js";
import { CodexProcessExitError } from "./review-run-codex-command.js";

export const REVIEW_RUN_TERMINAL_FAILURE_CODES = Object.freeze([
  "authentication_failed",
  "configuration_unavailable",
  "deadline_exceeded",
  "cancelled_by_operator",
  "subscription_exhausted",
  "context_exhausted",
  "resource_exhausted",
  "result_not_submitted",
  "codex_process_failed",
  "codex_protocol_failed",
  "submission_failed",
  "unexpected_execution_failure",
]);

const FAILURE_PATTERNS = Object.freeze([
  Object.freeze({
    code: "authentication_failed",
    pattern:
      /\b(?:401|authentication|log(?:ged)? in|refresh token|unauthorized)\b/i,
  }),
  Object.freeze({
    code: "subscription_exhausted",
    pattern:
      /\b(?:credits|quota exceeded|rate limit|spend cap|usage limit|usage not included|upgrade to plus)\b/i,
  }),
  Object.freeze({
    code: "context_exhausted",
    pattern:
      /(?:\b(?:context window|session budget)\b.*\b(?:exceeded|exhausted|room)\b|\b(?:exceeded|exhausted|room)\b.*\b(?:context window|session budget)\b)/i,
  }),
  Object.freeze({
    code: "resource_exhausted",
    pattern:
      /\b(?:at capacity|high demand|resource exhausted|server overloaded)\b/i,
  }),
  Object.freeze({
    code: "configuration_unavailable",
    pattern:
      /\b(?:bad request|configuration|invalid request|model is not supported|unsupported operation)\b/i,
  }),
]);

const CONFIGURATION_STDERR_PATTERN =
  /^(?:Error (?:finding codex home|loading config\.toml|loading rules|parsing -c overrides):|No default OSS provider configured)/i;

/** @param {unknown} value */
function isRecord(value) {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** @param {string} detail */
function mapMessage(detail) {
  if (
    /\b(?:failed to serialize exec json event|session configured event was not the first event)\b/i.test(
      detail,
    )
  ) {
    return { code: "codex_protocol_failed", detail };
  }
  const mapping = FAILURE_PATTERNS.find(({ pattern }) => pattern.test(detail));
  return {
    code: mapping?.code ?? "unexpected_execution_failure",
    detail,
  };
}

/** @param {string} stdout @param {string} stderr */
export function mapCodexTerminalFailure(stdout, stderr) {
  if (typeof stdout !== "string" || typeof stderr !== "string") {
    throw new TypeError("Review Run process transcript is invalid");
  }
  /** @type {string | undefined} */
  let terminalMessage;
  for (const line of stdout.trimEnd().split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return {
        code: "codex_protocol_failed",
        detail: "Codex Review Run terminal event is invalid",
      };
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      return {
        code: "codex_protocol_failed",
        detail: "Codex Review Run terminal event is invalid",
      };
    }
    if (event.type === "turn.failed") {
      if (
        !isRecord(event.error) ||
        typeof event.error.message !== "string" ||
        event.error.message.trim().length === 0
      ) {
        return {
          code: "codex_protocol_failed",
          detail: "Codex Review Run terminal event is invalid",
        };
      }
      terminalMessage = event.error.message;
      continue;
    }
    if (event.type === "error") {
      if (
        typeof event.message !== "string" ||
        event.message.trim().length === 0
      ) {
        return {
          code: "codex_protocol_failed",
          detail: "Codex Review Run terminal event is invalid",
        };
      }
      terminalMessage = event.message;
    }
  }
  if (terminalMessage !== undefined) {
    return mapMessage(terminalMessage);
  }
  const startupDetail = stderr.trim();
  if (startupDetail.length === 0) {
    return undefined;
  }
  const mapping = FAILURE_PATTERNS.find(({ pattern }) =>
    pattern.test(startupDetail),
  );
  if (!mapping && !CONFIGURATION_STDERR_PATTERN.test(startupDetail)) {
    return undefined;
  }
  return {
    code: mapping?.code ?? "configuration_unavailable",
    detail: startupDetail,
  };
}

/**
 * @param {string} detail
 * @param {Record<string, string>} environment
 */
function secretSafeCodexDetail(detail, environment) {
  let safe = detail;
  for (const [name, value] of Object.entries(environment)) {
    if (name.endsWith("_TOKEN") && value.length > 0) {
      safe = safe.replaceAll(value, "[REDACTED]");
    }
  }
  return safe;
}

/**
 * @param {{code: number | null, signal: NodeJS.Signals | null, stderr: string, stdout: string}} process
 * @param {Record<string, string>} environment
 */
export function createCodexProcessFailure(process, environment) {
  const mapped = mapCodexTerminalFailure(process.stdout, process.stderr);
  return new ReviewRunExecutionError(
    mapped?.code ?? "codex_process_failed",
    mapped
      ? secretSafeCodexDetail(mapped.detail, environment)
      : "Codex Review Run process failed",
    { cause: new CodexProcessExitError(process) },
  );
}

/** @param {unknown} failure */
export function createSubmissionFailure(failure) {
  if (
    failure instanceof Error &&
    "code" in failure &&
    failure.code === "storage_unavailable"
  ) {
    return failure;
  }
  return new ReviewRunExecutionError(
    "submission_failed",
    "Review Run submission failed",
    failure instanceof Error ? { cause: failure } : undefined,
  );
}
