import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { runReviewRunCodex } from "../src/review-run-codex-adapter.js";
import { ReviewRunExecutionError } from "../src/review-run-result.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});
const run = Object.freeze({
  configuration: {
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    service_tier: "fast",
  },
  criteria: [{ criterionId: "criterion-1" }],
  prompt: "Review the frozen Changeset",
});

function processThatCompletesWithUsage() {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 77,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stdout.write('{"type":"thread.started"}\n');
    process.stdout.end(
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":45,"output_tokens":30}}\n',
    );
    process.stderr.end("pinned diagnostic\n");
    child.emit("exit", 0, null);
  });
  return process;
}

test("streams exact transcript chunks and retains supplied terminal counters and exit facts", async () => {
  /** @type {unknown[]} */
  const evidence = [];
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk(evidenceClaim, stream, content) {
            evidence.push(["chunk", evidenceClaim, stream, content]);
          },
          complete(evidenceClaim, facts) {
            evidence.push(["complete", evidenceClaim, facts]);
          },
        },
        openSubmissionChannel: async () => ({
          accepted: () => false,
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {
            QUALITY_BAR_SUBMIT_SOCKET: "/socket",
            QUALITY_BAR_SUBMIT_TOKEN: "secret",
          },
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { submit() {} },
        run,
        spawnProcess: () =>
          /** @type {any} */ (processThatCompletesWithUsage()),
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "result_not_submitted",
  );

  assert.deepEqual(evidence, [
    ["chunk", claim, "stdout", '{"type":"thread.started"}\n'],
    [
      "chunk",
      claim,
      "stdout",
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":45,"output_tokens":30}}\n',
    ],
    ["chunk", claim, "stderr", "pinned diagnostic\n"],
    [
      "complete",
      claim,
      {
        exitCode: 0,
        signal: null,
        tokenCounters: {
          cached_input_tokens: 45,
          input_tokens: 120,
          output_tokens: 30,
        },
      },
    ],
  ]);
});
