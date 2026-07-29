import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review-run-result.js";
import { runReviewRunCodex } from "./review-run-codex-adapter-support.js";

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
    child.emit("close", 0, null);
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
          submission: () => undefined,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {}, submitPrepared() {} },
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

test("terminal evidence failure prevents the prepared Result from committing", async () => {
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    {
      code: "storage_unavailable",
    },
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 78,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  let resultCommitted = false;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {},
          complete() {
            throw storageFailure;
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -78);
          if (signal === "SIGTERM") {
            queueMicrotask(() => {
              child.stdout.end();
              child.stderr.end();
              child.emit("close", null, "SIGTERM");
            });
            return;
          }
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          accepted: () => true,
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          submission: () => ({ prepared: true }),
          waitForResult: async () => "accepted",
        }),
        resultService: {
          prepare() {},
          submitPrepared() {
            resultCommitted = true;
          },
        },
        run,
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => error === storageFailure,
  );
  assert.equal(resultCommitted, false);
});
