import { readTerminalTokenCounters } from "./review-run-evidence.js";

/** @param {any} claim */
function assertClaim(claim) {
  if (
    typeof claim?.workId !== "string" ||
    typeof claim?.workerId !== "string" ||
    !Number.isSafeInteger(claim?.fencingToken) ||
    claim.fencingToken < 1
  ) {
    throw new TypeError("Waiver Adjudication evidence claim is invalid");
  }
}

/** @param {any} transaction @param {any} claim */
function assertAuthoritative(transaction, claim) {
  const row = transaction.get(
    `SELECT waiver_adjudications.execution_status,
            codex_execution_queue.worker_id,
            codex_execution_queue.fencing_token
     FROM waiver_adjudications
     JOIN codex_execution_queue
       ON codex_execution_queue.work_id = waiver_adjudications.id
      AND codex_execution_queue.work_kind = 'waiver_adjudication'
     WHERE waiver_adjudications.id = ?`,
    claim.workId,
  );
  if (
    !row ||
    !["running", "completed", "failed", "cancelled"].includes(
      String(row.execution_status),
    ) ||
    row.worker_id !== claim.workerId ||
    row.fencing_token !== claim.fencingToken
  ) {
    throw new TypeError(
      "Waiver Adjudication evidence claim is not authoritative",
    );
  }
}

/** @param {any} durableCore */
export function createWaiverAdjudicationEvidenceService(durableCore) {
  return {
    /** @param {any} claim @param {"stdout" | "stderr"} stream @param {string} content */
    appendTranscriptChunk(claim, stream, content) {
      assertClaim(claim);
      if (
        !["stdout", "stderr"].includes(stream) ||
        typeof content !== "string" ||
        content.length === 0
      ) {
        throw new TypeError("Waiver Adjudication transcript chunk is invalid");
      }
      durableCore.transaction((/** @type {any} */ transaction) => {
        assertAuthoritative(transaction, claim);
        const sequence =
          Number(
            transaction.get(
              `SELECT max(sequence) AS sequence
               FROM waiver_adjudication_transcript_chunks
               WHERE waiver_adjudication_id = ?`,
              claim.workId,
            )?.sequence ?? 0,
          ) + 1;
        transaction.run(
          `INSERT INTO waiver_adjudication_transcript_chunks (
             waiver_adjudication_id, sequence, stream, content
           ) VALUES (?, ?, ?, ?)`,
          claim.workId,
          sequence,
          stream,
          content,
        );
      });
    },
    /** @param {any} claim @param {any} facts */
    complete(claim, facts) {
      assertClaim(claim);
      const counters = facts?.tokenCounters;
      if (
        !counters ||
        !["input_tokens", "cached_input_tokens", "output_tokens"].every(
          (name) =>
            counters[name] === null ||
            (Number.isSafeInteger(counters[name]) && counters[name] >= 0),
        ) ||
        !(
          facts.exitCode === null ||
          (Number.isSafeInteger(facts.exitCode) && facts.exitCode >= 0)
        ) ||
        !(
          facts.signal === null ||
          (typeof facts.signal === "string" && facts.signal.length > 0)
        ) ||
        (facts.exitCode !== null && facts.signal !== null)
      ) {
        throw new TypeError("Waiver Adjudication terminal evidence is invalid");
      }
      durableCore.transaction((/** @type {any} */ transaction) => {
        assertAuthoritative(transaction, claim);
        if (
          transaction.run(
            `UPDATE waiver_adjudications
             SET process_exit_code = ?, process_signal = ?,
                 input_tokens = ?, cached_input_tokens = ?,
                 output_tokens = ?, execution_evidence_recorded = 1
             WHERE id = ? AND execution_evidence_recorded = 0`,
            facts.exitCode,
            facts.signal,
            counters.input_tokens,
            counters.cached_input_tokens,
            counters.output_tokens,
            claim.workId,
          ).changes !== 1
        ) {
          throw new TypeError(
            "Waiver Adjudication execution evidence is already recorded",
          );
        }
      });
    },
  };
}

/** @param {string} stdout */
export function readWaiverAdjudicationTokenCounters(stdout) {
  return readTerminalTokenCounters(stdout);
}
