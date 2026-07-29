const UNAVAILABLE_TOKEN_COUNTERS = Object.freeze({
  cached_input_tokens: null,
  input_tokens: null,
  output_tokens: null,
});

export const REVIEW_RUN_TRANSCRIPT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS review_run_transcript_chunks (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr')),
    content TEXT NOT NULL CHECK (length(content) > 0),
    PRIMARY KEY (review_run_id, sequence)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS review_run_transcript_chunk_immutable_update
    BEFORE UPDATE ON review_run_transcript_chunks
    BEGIN SELECT RAISE(ABORT, 'review_run_transcript_chunk_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_transcript_chunk_immutable_delete
    BEFORE DELETE ON review_run_transcript_chunks
    BEGIN SELECT RAISE(ABORT, 'review_run_transcript_chunk_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_transcript_chunk_requires_started_run
    BEFORE INSERT ON review_run_transcript_chunks
    WHEN (
      SELECT started_at FROM review_runs WHERE id = NEW.review_run_id
    ) IS NULL
    BEGIN SELECT RAISE(ABORT, 'review_run_transcript_chunk_run_not_started'); END;
`;

export const REVIEW_RUN_EVIDENCE_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS review_run_cli_version_immutable
    BEFORE UPDATE OF codex_cli_version ON review_runs
    WHEN OLD.codex_cli_version IS NOT NULL
      OR NEW.codex_cli_version IS NULL
      OR length(trim(NEW.codex_cli_version)) = 0
    BEGIN SELECT RAISE(ABORT, 'review_run_cli_version_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS review_run_execution_evidence_immutable
    BEFORE UPDATE OF
      process_exit_code,
      process_signal,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      execution_evidence_recorded
    ON review_runs
    WHEN OLD.execution_evidence_recorded <> 0
      OR NEW.execution_evidence_recorded <> 1
      OR (NEW.process_exit_code IS NOT NULL AND NEW.process_exit_code < 0)
      OR (NEW.process_signal IS NOT NULL AND length(NEW.process_signal) = 0)
      OR (
        NEW.process_exit_code IS NOT NULL
        AND NEW.process_signal IS NOT NULL
      )
      OR (NEW.input_tokens IS NOT NULL AND NEW.input_tokens < 0)
      OR (
        NEW.cached_input_tokens IS NOT NULL
        AND NEW.cached_input_tokens < 0
      )
      OR (NEW.output_tokens IS NOT NULL AND NEW.output_tokens < 0)
    BEGIN SELECT RAISE(ABORT, 'review_run_execution_evidence_invalid'); END;
`;

export const REVIEW_RUN_EVIDENCE_SCHEMA = `
  ${REVIEW_RUN_TRANSCRIPT_SCHEMA}
  ${REVIEW_RUN_EVIDENCE_INTEGRITY}
`;

/** @param {import("node:sqlite").DatabaseSync} database */
export function reviewRunEvidenceMigration(database) {
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(review_runs)")
      .all()
      .map((column) => column.name),
  );
  if (columns.size === 0) {
    return "";
  }
  return `
    ${columns.has("codex_cli_version") ? "" : "ALTER TABLE review_runs ADD COLUMN codex_cli_version TEXT;"}
    ${columns.has("process_exit_code") ? "" : "ALTER TABLE review_runs ADD COLUMN process_exit_code INTEGER;"}
    ${columns.has("process_signal") ? "" : "ALTER TABLE review_runs ADD COLUMN process_signal TEXT;"}
    ${columns.has("input_tokens") ? "" : "ALTER TABLE review_runs ADD COLUMN input_tokens INTEGER;"}
    ${columns.has("cached_input_tokens") ? "" : "ALTER TABLE review_runs ADD COLUMN cached_input_tokens INTEGER;"}
    ${columns.has("output_tokens") ? "" : "ALTER TABLE review_runs ADD COLUMN output_tokens INTEGER;"}
    ${columns.has("execution_evidence_recorded") ? "" : "ALTER TABLE review_runs ADD COLUMN execution_evidence_recorded INTEGER NOT NULL DEFAULT 0 CHECK (execution_evidence_recorded IN (0, 1));"}
    ${REVIEW_RUN_EVIDENCE_SCHEMA}
  `;
}

/** @param {unknown} value */
function tokenCounter(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0
    ? value
    : null;
}

/** @param {string} stdout */
export function readTerminalTokenCounters(stdout) {
  if (typeof stdout !== "string") {
    throw new TypeError("Review Run stdout transcript is invalid");
  }
  for (const line of stdout.trimEnd().split("\n").reverse()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !event ||
      Array.isArray(event) ||
      typeof event !== "object" ||
      event.type !== "turn.completed" ||
      !event.usage ||
      Array.isArray(event.usage) ||
      typeof event.usage !== "object"
    ) {
      continue;
    }
    const inputTokens = tokenCounter(event.usage.input_tokens);
    const outputTokens = tokenCounter(event.usage.output_tokens);
    if (inputTokens === null || outputTokens === null) {
      return { ...UNAVAILABLE_TOKEN_COUNTERS };
    }
    return {
      cached_input_tokens: tokenCounter(event.usage.cached_input_tokens),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
  }
  return { ...UNAVAILABLE_TOKEN_COUNTERS };
}

/**
 * @param {{complete: (claim: unknown, facts: unknown) => void}} evidenceService
 * @param {unknown} claim
 * @param {{code?: number | null, signal?: string | null} | undefined} process
 * @param {string} stdout
 */
export function captureEvidenceCompletionFailure(
  evidenceService,
  claim,
  process,
  stdout,
) {
  try {
    evidenceService.complete(claim, {
      exitCode: process?.code ?? null,
      signal: process?.signal ?? null,
      tokenCounters: readTerminalTokenCounters(stdout),
    });
  } catch (error) {
    return error instanceof Error
      ? error
      : new TypeError("Review Run evidence completion failed", {
          cause: error,
        });
  }
}

/** @param {unknown} claim */
function assertClaim(claim) {
  const input = /** @type {any} */ (claim);
  if (
    typeof input?.workId !== "string" ||
    input.workId.length === 0 ||
    typeof input.workerId !== "string" ||
    input.workerId.length === 0 ||
    !Number.isSafeInteger(input.fencingToken) ||
    input.fencingToken < 1
  ) {
    throw new TypeError("Review Run evidence claim is invalid");
  }
}

/** @param {any} durableCore */
export function createReviewRunEvidenceService(durableCore) {
  /** @param {any} transaction @param {any} claim */
  function assertAuthoritativeStartedRun(transaction, claim) {
    const run = transaction.get(
      `SELECT review_runs.execution_status,
              codex_execution_queue.worker_id,
              codex_execution_queue.fencing_token
       FROM review_runs
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = ?`,
      claim.workId,
    );
    if (
      !run ||
      !["running", "completed", "failed", "cancelled"].includes(
        String(run.execution_status),
      ) ||
      run.worker_id !== claim.workerId ||
      run.fencing_token !== claim.fencingToken
    ) {
      throw new TypeError("Review Run evidence claim is not authoritative");
    }
  }

  return {
    /** @param {unknown} claim @param {"stdout" | "stderr"} stream @param {string} content */
    appendTranscriptChunk(claim, stream, content) {
      assertClaim(claim);
      if (
        !["stdout", "stderr"].includes(stream) ||
        typeof content !== "string" ||
        content.length === 0
      ) {
        throw new TypeError("Review Run transcript chunk is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        assertAuthoritativeStartedRun(transaction, claim);
        const sequence =
          Number(
            transaction.get(
              `SELECT max(sequence) AS sequence
               FROM review_run_transcript_chunks
               WHERE review_run_id = ?`,
              /** @type {any} */ (claim).workId,
            )?.sequence ?? 0,
          ) + 1;
        transaction.run(
          `INSERT INTO review_run_transcript_chunks (
             review_run_id, sequence, stream, content
           ) VALUES (?, ?, ?, ?)`,
          /** @type {any} */ (claim).workId,
          sequence,
          stream,
          content,
        );
      });
    },
    /** @param {unknown} claim @param {any} facts */
    complete(claim, facts) {
      assertClaim(claim);
      const counters = facts?.tokenCounters;
      if (
        !(
          (facts?.exitCode === null ||
            (Number.isSafeInteger(facts.exitCode) && facts.exitCode >= 0)) &&
          (facts?.signal === null ||
            (typeof facts.signal === "string" && facts.signal.length > 0)) &&
          !(facts.exitCode !== null && facts.signal !== null) &&
          counters &&
          ["input_tokens", "cached_input_tokens", "output_tokens"].every(
            (name) =>
              counters[name] === null ||
              (Number.isSafeInteger(counters[name]) && counters[name] >= 0),
          )
        )
      ) {
        throw new TypeError("Review Run terminal evidence is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        assertAuthoritativeStartedRun(transaction, claim);
        const updated = transaction.run(
          `UPDATE review_runs
           SET process_exit_code = ?, process_signal = ?,
               input_tokens = ?, cached_input_tokens = ?, output_tokens = ?,
               execution_evidence_recorded = 1
           WHERE id = ?
             AND execution_evidence_recorded = 0`,
          facts.exitCode,
          facts.signal,
          counters.input_tokens,
          counters.cached_input_tokens,
          counters.output_tokens,
          /** @type {any} */ (claim).workId,
        );
        if (updated.changes !== 1) {
          throw new TypeError("Review Run terminal evidence is already stored");
        }
      });
    },
  };
}

/** @param {any} durableCore @param {string} evaluationId @param {string} reviewRunId */
export function readReviewRunDiagnostics(
  durableCore,
  evaluationId,
  reviewRunId,
) {
  const run = durableCore.get(
    `SELECT id, codex_cli_version, started_at, completed_at,
            process_exit_code, process_signal,
            input_tokens, cached_input_tokens, output_tokens
     FROM review_runs
     WHERE id = ? AND evaluation_id = ?`,
    reviewRunId,
    evaluationId,
  );
  if (!run) {
    return undefined;
  }
  const exitCode = run.process_exit_code;
  const signal = run.process_signal;
  const processFact =
    typeof exitCode === "number"
      ? { code: exitCode, kind: "exit" }
      : typeof signal === "string"
        ? { kind: "signal", signal }
        : { kind: "unavailable" };
  return {
    codex_cli_version: run.codex_cli_version,
    completed_at:
      typeof run.completed_at === "number"
        ? new Date(run.completed_at).toISOString()
        : null,
    duration_ms:
      typeof run.started_at === "number" && typeof run.completed_at === "number"
        ? run.completed_at - run.started_at
        : null,
    process: processFact,
    review_run_id: run.id,
    started_at:
      typeof run.started_at === "number"
        ? new Date(run.started_at).toISOString()
        : null,
    token_counters: {
      cached_input_tokens: run.cached_input_tokens,
      input_tokens: run.input_tokens,
      output_tokens: run.output_tokens,
    },
    transcript_chunks: durableCore.all(
      `SELECT sequence, stream, content
       FROM review_run_transcript_chunks
       WHERE review_run_id = ?
       ORDER BY sequence`,
      reviewRunId,
    ),
  };
}
