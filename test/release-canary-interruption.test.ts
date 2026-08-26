import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runReleaseCanary } from "../scripts/release-canary/evidence.mts";

test("a failed or interrupted canary cannot reuse an earlier pass", async () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-"));
  const evidencePath = join(directory, "canary.json");
  const sourceCommit = "a".repeat(40);
  const invocationIdentity = { attemptId: "attempt-2", command: "canary:test" };
  const invocation = Promise.withResolvers();
  try {
    writeFileSync(
      evidencePath,
      JSON.stringify({ kind: "test-canary", outcome: "pass", sourceCommit }),
    );

    const running = runReleaseCanary({
      evidencePath,
      failure: () => ({
        failure: { code: "canary_failed", detail: "canary failed" },
        kind: "test-canary",
        outcome: "fail",
        sourceCommit,
      }),
      invocation: invocationIdentity,
      invoke: () => invocation.promise,
      sourceCommit,
    });

    assert.equal(existsSync(evidencePath), false);

    invocation.reject(new Error("provider failed"));
    const failed = await running;
    assert.equal(failed.outcome, "fail");
    assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), failed);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
