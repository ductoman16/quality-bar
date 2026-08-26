import { randomUUID } from "node:crypto";

import { completeEvaluationIfTerminal } from "../evaluation/evaluation-aggregation.ts";
import { storeEvaluationFileChanges } from "../evaluation/evaluation-file-change-persistence.ts";
import { createReviewRunFailureService } from "./review-run-failure.ts";
import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "./review-run-result.ts";

function fail(code: string, message: string): never {
  throw new ReviewRunExecutionError(code, message);
}

function readAuthoritativeRun(
  transaction: any,
  claim: any,
  observedAt: number,
) {
  const run = transaction.get(
    `SELECT review_runs.evaluation_id, review_runs.review_version_id,
            review_runs.execution_status,
            codex_execution_queue.worker_id,
            codex_execution_queue.fencing_token,
            codex_execution_queue.lease_expires_at
     FROM review_runs
     JOIN codex_execution_queue
       ON codex_execution_queue.work_id = review_runs.id
     WHERE review_runs.id = ?`,
    claim.workId,
  );
  if (
    !run ||
    run.execution_status !== "running" ||
    run.worker_id !== claim.workerId ||
    run.fencing_token !== claim.fencingToken ||
    typeof run.lease_expires_at !== "number" ||
    run.lease_expires_at <= observedAt
  ) {
    fail(
      "submission_channel_closed",
      "Review Run submission channel is closed",
    );
  }
  return run;
}

function readCriteria(transaction: any, run: any) {
  return transaction
    .all(
      `SELECT criterion_id, impact
       FROM review_version_criteria
       WHERE review_version_id = ?
       ORDER BY position`,
      run.review_version_id,
    )
    .map((row: any) => {
      if (
        typeof row?.criterion_id !== "string" ||
        !["advisory", "blocking"].includes(String(row.impact))
      ) {
        throw new TypeError("Frozen Review Criterion is invalid");
      }
      return { criterion_id: row.criterion_id, impact: String(row.impact) };
    });
}

function storeResultFacts(transaction: any, run: any, submission: any) {
  storeEvaluationFileChanges(
    transaction,
    run.evaluation_id,
    submission.workId,
    submission.fileChanges,
  );
  for (const result of submission.results) {
    transaction.run(
      `INSERT INTO criterion_results (
         review_run_id, criterion_id, outcome, error_code, error_detail
       ) VALUES (?, ?, ?, ?, ?)`,
      submission.workId,
      result.criterion_id,
      result.outcome,
      result.error?.code ?? null,
      result.error?.detail ?? null,
    );
    for (const finding of result.findings ?? []) {
      const location = finding.location;
      transaction.run(
        `INSERT INTO findings (
           id, evaluation_id, review_run_id, criterion_id,
           evidence, remediation, location_kind, file_change_id,
           side, start_line, end_line
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        submission.createFindingId(),
        run.evaluation_id,
        submission.workId,
        result.criterion_id,
        finding.evidence,
        finding.remediation,
        location.kind,
        location.file_change_id ?? null,
        location.side ?? null,
        location.start_line ?? null,
        location.end_line ?? null,
      );
    }
  }
}

export function createReviewRunResultService(
  durableCore: any,
  {
    createFindingId = randomUUID,
    now = () => Date.now(),
  }: { createFindingId?: () => string; now?: () => number } = {},
) {
  const service = {
    fail: createReviewRunFailureService(durableCore, now, fail),
    prepare(claim: any, candidate: unknown, fileChanges: any[]) {
      if (!Array.isArray(fileChanges)) {
        throw new TypeError("Frozen File Changes are required");
      }
      const checkedAt = now();
      if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) {
        throw new TypeError("Review Run submission time is invalid");
      }
      return durableCore.transaction((transaction: any) => {
        const run = readAuthoritativeRun(transaction, claim, checkedAt);
        const criteria = readCriteria(transaction, run);
        const results = validateReviewRunSubmission(
          candidate,
          criteria,
          fileChanges,
        );
        if (
          new Set(fileChanges.map(({ id }) => id)).size !== fileChanges.length
        ) {
          throw new TypeError("Frozen File Change identity is invalid");
        }
        const frozenFileChanges = fileChanges.map((fileChange) => {
          if (typeof fileChange.patch !== "string") {
            throw new TypeError("Frozen File Change patch is invalid");
          }
          return { ...fileChange };
        });
        const submission = {
          criteria,
          evaluationId: run.evaluation_id,
          fileChanges: frozenFileChanges,
          results,
          reviewVersionId: run.review_version_id,
        };
        const acceptedAt = now();
        if (
          !Number.isSafeInteger(acceptedAt) ||
          acceptedAt < checkedAt ||
          run.lease_expires_at <= acceptedAt
        ) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        storeResultFacts(transaction, run, {
          ...submission,
          createFindingId,
          workId: claim.workId,
        });
        if (
          transaction.run(
            `UPDATE review_runs
             SET execution_status = 'completed', completed_at = ?
             WHERE id = ? AND execution_status = 'running'
               AND completed_at IS NULL`,
            acceptedAt,
            claim.workId,
          ).changes !== 1
        ) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        completeEvaluationIfTerminal(
          transaction,
          run.evaluation_id,
          acceptedAt,
        );
      });
    },
  };
  return service;
}
