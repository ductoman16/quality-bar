import assert from "node:assert/strict";

import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";

/** @param {any} core */
export function assertSupersessionFencesRunningWorker(core) {
  const criterion = core.get(
    `SELECT criterion_id FROM review_version_criteria
     WHERE review_version_id = (
       SELECT review_version_id FROM review_runs WHERE id = 'review-run-1'
     )`,
  );
  assert.ok(criterion);
  assert.throws(
    () =>
      createReviewRunResultService(core, { now: () => 12 }).prepare(
        {
          fencingToken: 1,
          workerId: "worker-1",
          workId: "review-run-1",
        },
        {
          criterion_results: [
            { criterion_id: criterion.criterion_id, outcome: "clear" },
          ],
        },
        [],
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Review Run submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
}
