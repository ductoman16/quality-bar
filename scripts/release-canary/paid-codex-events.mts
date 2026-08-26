export const PAID_CODEX_SUBMISSION_COMMAND =
  "quality-bar-submit .quality-bar-result.json";

const PAID_CODEX_SUBMISSION_EVENT_COMMANDS = new Set([
  PAID_CODEX_SUBMISSION_COMMAND,
  ...["/bin/bash", "/bin/sh", "/bin/zsh"].flatMap((shell) => [
    `${shell} -c '${PAID_CODEX_SUBMISSION_COMMAND}'`,
    `${shell} -c "${PAID_CODEX_SUBMISSION_COMMAND}"`,
  ]),
]);
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_EVENTS = 256;
const EVENT_COUNT_NAMES = Object.freeze({
  "item.completed": "itemCompleted",
  "item.started": "itemStarted",
  "thread.started": "threadStarted",
  "turn.completed": "turnCompleted",
  "turn.failed": "turnFailed",
  "turn.started": "turnStarted",
} as Record<
  string,
  | "itemCompleted"
  | "itemStarted"
  | "threadStarted"
  | "turnCompleted"
  | "turnFailed"
  | "turnStarted"
>);

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code, safeCanaryDetail: true });
}

export function safeProcessDiagnostics(error: unknown) {
  const process = (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause &&
    typeof error.cause === "object"
      ? error.cause
      : null
  ) as {
    code?: unknown;
    signal?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  } | null;
  if (
    !process ||
    typeof process.stdout !== "string" ||
    typeof process.stderr !== "string"
  ) {
    return undefined;
  }
  const knownEventCounts = {
    itemCompleted: 0,
    itemStarted: 0,
    threadStarted: 0,
    turnCompleted: 0,
    turnFailed: 0,
    turnStarted: 0,
  };
  let commandExecutions = 0;
  let exactSubmissionCommandEvents = 0;
  let failedCommandExecutions = 0;
  let invalidJsonlLines = 0;
  let unknownEventTypes = 0;
  let eventsInspected = 0;
  const stdoutBytes = Buffer.byteLength(process.stdout);
  const boundedStdout = process.stdout.slice(0, MAX_DIAGNOSTIC_BYTES);
  const lines = boundedStdout.split("\n");
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    if (eventsInspected === MAX_DIAGNOSTIC_EVENTS) {
      break;
    }
    eventsInspected += 1;
    try {
      const event = JSON.parse(line);
      const countName = EVENT_COUNT_NAMES[event?.type];
      if (countName) {
        knownEventCounts[countName] += 1;
      } else {
        unknownEventTypes += 1;
      }
      if (event?.item?.type === "command_execution") {
        commandExecutions += 1;
        if (PAID_CODEX_SUBMISSION_EVENT_COMMANDS.has(event.item.command)) {
          exactSubmissionCommandEvents += 1;
        }
        if (
          event.item.status === "failed" ||
          (Number.isSafeInteger(event.item.exit_code) &&
            event.item.exit_code !== 0)
        ) {
          failedCommandExecutions += 1;
        }
      }
    } catch {
      invalidJsonlLines += 1;
    }
  }
  return {
    commandExecutions,
    eventsInspected,
    eventsTruncated:
      stdoutBytes > MAX_DIAGNOSTIC_BYTES ||
      lines.filter((line) => line.length > 0).length > MAX_DIAGNOSTIC_EVENTS,
    exactSubmissionCommandEvents,
    exitCode: Number.isSafeInteger(process.code) ? process.code : null,
    failedCommandExecutions,
    invalidJsonlLines,
    knownEventCounts,
    signaled: typeof process.signal === "string",
    stderrBytes: Buffer.byteLength(process.stderr),
    stdoutBytes,
    unknownEventTypes,
  };
}

export function readPaidCodexEventEvidence(
  stdout: string,
  acceptedAt: number | null,
) {
  let submissionCommandCompleted = false;
  let submissionCommandFailed = false;
  let submissionCommandStarted: { command: string; id: string } | null = null;
  let turnStarted = false;
  let consumed = 0;
  const lines = stdout.split("\n");
  for (const [index, line] of lines.entries()) {
    consumed += line.length + (index < lines.length - 1 ? 1 : 0);
    if (line.length === 0) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw failure(
        "paid_codex_canary_event_protocol_invalid",
        "paid Codex canary stdout is not valid JSONL event output",
      );
    }
    if (
      !event ||
      Array.isArray(event) ||
      typeof event !== "object" ||
      typeof event.type !== "string" ||
      event.type.length === 0
    ) {
      throw failure(
        "paid_codex_canary_event_protocol_invalid",
        "paid Codex canary stdout is not valid JSONL event output",
      );
    }
    const beforeAcceptance = acceptedAt !== null && consumed <= acceptedAt;
    turnStarted ||= beforeAcceptance && event.type === "turn.started";
    const exactSubmission =
      event.item?.type === "command_execution" &&
      PAID_CODEX_SUBMISSION_EVENT_COMMANDS.has(event.item.command);
    if (exactSubmission && event.type === "item.started") {
      const validStart =
        typeof event.item.id === "string" &&
        event.item.id.length > 0 &&
        (event.item.status === undefined ||
          event.item.status === "in_progress") &&
        (event.item.exit_code === undefined || event.item.exit_code === null);
      if (beforeAcceptance && validStart && submissionCommandStarted === null) {
        submissionCommandStarted = {
          command: event.item.command,
          id: event.item.id,
        };
      } else {
        submissionCommandFailed = true;
      }
    } else if (exactSubmission && event.type === "item.completed") {
      const validCompletion =
        submissionCommandStarted !== null &&
        event.item.id === submissionCommandStarted.id &&
        event.item.command === submissionCommandStarted.command &&
        event.item.status === "completed" &&
        event.item.exit_code === 0;
      submissionCommandCompleted ||= !beforeAcceptance && validCompletion;
      submissionCommandFailed ||= !validCompletion;
    }
  }
  if (
    !turnStarted ||
    submissionCommandStarted === null ||
    !submissionCommandCompleted ||
    submissionCommandFailed
  ) {
    throw failure(
      "paid_codex_canary_event_evidence_missing",
      "paid Codex canary JSONL event evidence is incomplete",
    );
  }
  return { submissionCommandAccepted: true, turnStarted };
}
