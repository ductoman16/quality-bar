import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createSubmissionFailure } from "../src/review/review-run-codex-failure.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";
import { executeFailedReviewRun } from "./review-run-result-sqlite-integration-support.ts";

test("a generic coded submission failure persists only the stable submission error", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-coded-submission-failure-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const underlyingFailure = Object.assign(
    new Error("socket failure with sensitive detail"),
    { code: "EPIPE" },
  );
  const failure = createSubmissionFailure(underlyingFailure);

  await assert.rejects(
    () => executeFailedReviewRun(core, failure),
    (error) => error === failure,
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail
       FROM review_runs`,
    ),
    {
      error_code: "submission_failed",
      error_detail: "Review Run submission failed",
      execution_status: "failed",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
});
