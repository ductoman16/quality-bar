import {
  count,
  exact,
  nonempty,
  record,
  requiredTimestamp as timestamp,
} from "../contract.js";
import { validProcess } from "./result-contract.js";

export function validReviewRunDiagnostics(
  /** @type {any} */ value,
  /** @type {string} */ reviewRunId,
) {
  const counter = (/** @type {any} */ item) => item === null || count(item);
  return (
    record(value) &&
    exact(value, [
      "codex_cli_version",
      "completed_at",
      "duration_ms",
      "process",
      "review_run_id",
      "started_at",
      "token_counters",
      "transcript_chunks",
    ]) &&
    value.review_run_id === reviewRunId &&
    (value.started_at === null || timestamp(value.started_at)) &&
    (value.completed_at === null || timestamp(value.completed_at)) &&
    (value.codex_cli_version === null || nonempty(value.codex_cli_version)) &&
    counter(value.duration_ms) &&
    validProcess(value.process) &&
    record(value.token_counters) &&
    exact(value.token_counters, [
      "cached_input_tokens",
      "input_tokens",
      "output_tokens",
    ]) &&
    ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
      counter(value.token_counters[name]),
    ) &&
    Array.isArray(value.transcript_chunks) &&
    value.transcript_chunks.every(
      (/** @type {any} */ chunk) =>
        record(chunk) &&
        exact(chunk, ["content", "sequence", "stream"]) &&
        Number.isSafeInteger(chunk.sequence) &&
        chunk.sequence > 0 &&
        ["stdout", "stderr"].includes(chunk.stream) &&
        nonempty(chunk.content),
    )
  );
}
