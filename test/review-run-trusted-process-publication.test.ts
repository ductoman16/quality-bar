import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.ts";
import { publishFile } from "../src/review/review-run-submission-files.ts";
import { processGroupIdentity } from "../src/review/review-run-submission-process-group.ts";

test("publishes trusted-process provenance within the command filesystem", async () => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "trusted-process-"));
  let trustedProcessPublished = false;
  const channel = await openReviewRunSubmissionChannel(
    { fencingToken: 1, workerId: "worker-1", workId: "run-1" },
    { prepare() {} },
    {
      checkoutPath,
      publishFile(temporaryPath, targetPath) {
        if (temporaryPath.includes("quality-bar-submit-process.tmp-")) {
          trustedProcessPublished = true;
          assert.equal(dirname(temporaryPath), dirname(targetPath));
        }
        return publishFile(temporaryPath, targetPath);
      },
    },
  );
  try {
    channel.bindProcessGroup(processGroupIdentity(process.pid) as number);
    assert.equal(trustedProcessPublished, true);
  } finally {
    await channel.close();
    rmSync(checkoutPath, { force: true, recursive: true });
  }
});
