import { createIoExecutionPool } from "../src/io-execution-pool.ts";
import assert from "node:assert/strict";

import { executeReviewRun } from "../src/review/review-run-execution.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review/review-run-result.ts";

export function assertRejectedCandidatesStoreNothing(
  core: ReturnType<
    typeof import("../src/durable/durable-core.ts").openDurableCore
  >,
  results: ReturnType<typeof createReviewRunResultService>,
  claim: { fencingToken: number; workerId: string; workId: string },
  fileChanges: any[],
  criterionIds: string[],
) {
  for (const [candidate, code] of [
    [
      {
        criterion_results: [
          { criterion_id: criterionIds[0], outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: criterionIds.map((criterionId, index) => ({
          criterion_id: index === 1 ? criterionIds[0] : criterionId,
          outcome: "clear",
        })),
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: [
          ...criterionIds.map((criterionId) => ({
            criterion_id: criterionId,
            outcome: "clear",
          })),
          { criterion_id: "criterion-extra", outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
    ],
    [{ criterion_results: [null] }, "criterion_result_invalid"],
    [{}, "review_run_submission_invalid"],
    [
      {
        criterion_results: criterionIds.map((criterionId, index) => ({
          criterion_id: criterionId,
          outcome: index === 0 ? "triggered" : "clear",
        })),
      },
      "criterion_result_invalid",
    ],
    [
      {
        criterion_results: criterionIds.map((criterionId, index) =>
          index === 0
            ? {
                criterion_id: criterionId,
                findings: [
                  {
                    evidence: "The submitted range invents a head line.",
                    location: {
                      end_line: 4,
                      file_change_id: "file-change-1",
                      kind: "line_range",
                      side: "head",
                      start_line: 4,
                    },
                    remediation:
                      "Use an inclusive range within the frozen side.",
                  },
                ],
                outcome: "triggered",
              }
            : { criterion_id: criterionId, outcome: "clear" },
        ),
      },
      "finding_location_line_range_invalid",
    ],
  ]) {
    assert.throws(
      () => results.prepare(claim, candidate, fileChanges),
      (error) =>
        error instanceof ReviewRunExecutionError && error.code === code,
    );
  }
  for (const table of [
    "criterion_results",
    "evaluation_file_changes",
    "evaluation_results",
    "findings",
  ]) {
    assert.equal(core.get(`SELECT count(*) AS count FROM ${table}`)?.count, 0);
  }
}

export async function executeFailedReviewRun(
  core: ReturnType<
    typeof import("../src/durable/durable-core.ts").openDurableCore
  >,
  underlyingFailure: Error,
) {
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "unexpected-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  if (!claim) {
    throw new Error("Expected a queued Review Run");
  }
  return executeReviewRun(core, claim, {
    ioPool: createIoExecutionPool(),
    claimService: claims,
    prepareCheckout: async () => ({
      path: "/discarded-checkout",
      remove() {},
    }),
    readFileChanges: () => [],
    resultService: createReviewRunResultService(core, { now: () => 30 }),
    async runCodex(input) {
      input.startProcessGroup?.(process.pid);
      throw underlyingFailure;
    },
  });
}
