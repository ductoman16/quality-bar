import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createReviewRunClaimService } from "../src/review/review-run-claim.js";
import { createReviewRunEvidenceService } from "../src/review/review-run-evidence.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("a transcript-chunk write failure enters the hard storage_unavailable gate", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-transcript-write-fail-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  /** @type {Array<Error & {code: string}>} */
  const failures = [];
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"), {
    onStorageUnavailable(error) {
      failures.push(error);
    },
  });
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "transcript-failure-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");

  core.run("PRAGMA query_only = ON");
  assert.throws(
    () =>
      createReviewRunEvidenceService(core).appendTranscriptChunk(
        claim,
        "stdout",
        '{"type":"thread.started"}\n',
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable" &&
      error.message === "SQLite durable write failed",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "storage_unavailable");
  assert.equal(
    failures[0].cause instanceof Error &&
      failures[0].cause.message.includes("readonly"),
    true,
  );
});
