import assert from "node:assert/strict";

import { executeReviewRun } from "../src/review-run-execution.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 * @param {ReturnType<typeof createReviewRunResultService>} results
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {any[]} fileChanges
 * @param {string[]} criterionIds
 */
export function assertRejectedCandidatesStoreNothing(
  core,
  results,
  claim,
  fileChanges,
  criterionIds,
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

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 * @param {Error} underlyingFailure
 */
export async function executeFailedReviewRun(core, underlyingFailure) {
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "unexpected-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  if (!claim) {
    throw new Error("Expected a queued Review Run");
  }
  return executeReviewRun(core, claim, {
    claimService: claims,
    prepareCheckout: async () => ({
      path: "/discarded-checkout",
      remove() {},
    }),
    readFileChanges: () => [],
    resultService: createReviewRunResultService(core, { now: () => 30 }),
    async runCodex(input) {
      input.startRun?.();
      throw underlyingFailure;
    },
  });
}
