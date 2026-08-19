import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  runReleaseCanary,
  writeCanaryEvidence,
} from "../scripts/release-canary/evidence.mjs";

test("a failed or interrupted canary cannot reuse an earlier pass", async () => {
  const directory = mkdtempSync(join(tmpdir(), "release-canary-"));
  const evidencePath = join(directory, "canary.json");
  const sourceCommit = "a".repeat(40);
  const attempt = {
    failure: { code: "canary_attempt_started", detail: "attempt started" },
    invocation: { attemptId: "attempt-2", command: "canary:test" },
    kind: "test-canary",
    outcome: "fail",
    sourceCommit,
  };
  const invocation = Promise.withResolvers();
  try {
    writeCanaryEvidence(evidencePath, {
      invocation: { attemptId: "attempt-1", command: "canary:test" },
      kind: "test-canary",
      outcome: "pass",
      sourceCommit,
    });

    const running = runReleaseCanary({
      attempt,
      evidencePath,
      failure: () => ({
        failure: { code: "canary_failed", detail: "canary failed" },
        kind: "test-canary",
        outcome: "fail",
        sourceCommit,
      }),
      invoke: () => invocation.promise,
    });

    assert.deepEqual(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      attempt,
      "the durable failed attempt replaces the pass before provider work",
    );

    invocation.reject(new Error("provider failed"));
    const failed = await running;
    assert.equal(failed.outcome, "fail");
    assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), failed);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
