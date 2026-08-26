import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review/review-run-result.ts";
import {
  runningProcess,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.ts";

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
  const evidence: unknown[] = [];
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
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {
            QUALITY_BAR_SUBMIT_FILE: "/socket",
            QUALITY_BAR_SUBMIT_TOKEN: "secret",
          },
          failure: () => null,
          lastValidationFailure: () => null,
          submission: () => undefined,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => processThatCompletesWithUsage() as any,
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

test("transcript failure closes submission before terminating Codex", async () => {
  const storageFailure = Object.assign(new Error("transcript write failed"), {
    code: "storage_unavailable",
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 82,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  const events: (string | number)[] = [];
  let accepted = false;
  let closed = false;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        clearTerminationTimer() {},
        evidenceService: {
          appendTranscriptChunk() {
            throw storageFailure;
          },
          complete() {
            assert.fail("terminal evidence followed transcript failure");
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -82);
          events.push(signal);
          if (signal === "SIGTERM") {
            accepted = !closed;
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          accepted: () => accepted,
          bindProcessGroup() {},
          async close() {
            closed = true;
            events.push("submission-closed");
          },
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => Promise.resolve("accepted"),
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess() {
          queueMicrotask(() => child.stdout.write("raw JSONL\n"));
          return child as any;
        },
      }),
    (error) => error === storageFailure,
  );
  assert.equal(accepted, false);
  assert.deepEqual(events, ["submission-closed", "SIGTERM", 0]);
});

test("terminal evidence failure remains exact after Result acceptance", async () => {
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
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          submission: () => ({ prepared: true }),
          waitForResult: async () => "accepted",
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => child as any,
      }),
    (error) => error === storageFailure,
  );
});

test("a transcript write failure immediately terminates Codex with its owning error", async () => {
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    {
      code: "storage_unavailable",
    },
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 79,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  const signals: (string | number)[] = [];
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {
            throw storageFailure;
          },
          complete() {
            assert.fail("terminal evidence followed transcript failure");
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -79);
          signals.push(signal);
          if (signal === "SIGTERM") {
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          accepted: () => false,
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess() {
          queueMicrotask(() => child.stdout.write("raw JSONL\n"));
          return child as any;
        },
      }),
    (error) => error === storageFailure,
  );
  assert.deepEqual(signals, ["SIGTERM", 0]);
});

test("claim start failures remain exact and prevent Codex launch", async () => {
  const claimFailure = new ReviewRunExecutionError(
    "review_run_claim_lost",
    "Review Run claim is no longer authoritative",
  );
  let codexLaunched = false;
  let supervisorPrepared = false;
  const supervisor = runningProcess(76);
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => ({
          accepted: () => false,
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        prepareProcess() {
          supervisorPrepared = true;
          return {
            async abort() {
              supervisor.stdout.end();
              supervisor.stderr.end();
              supervisor.emit("close", 0, null);
            },
            child: supervisor as any,
            async finish() {},
            async start() {
              codexLaunched = true;
            },
          };
        },
        startRun() {
          throw claimFailure;
        },
      }),
    (error) => error === claimFailure,
  );
  assert.equal(supervisorPrepared, true);
  assert.equal(codexLaunched, false);
});

test("transcript failure surfaces even when process termination also fails", async () => {
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    {
      code: "storage_unavailable",
    },
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 80,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {
            throw storageFailure;
          },
          complete() {
            assert.fail("terminal evidence followed transcript failure");
          },
        },
        killProcessGroup() {
          throw Object.assign(new Error("kill not permitted"), {
            code: "EPERM",
          });
        },
        openSubmissionChannel: async () => ({
          accepted: () => false,
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess() {
          queueMicrotask(() => child.stdout.write("raw JSONL\n"));
          return child as any;
        },
      }),
    (error) => {
      assert.equal(error, storageFailure);
      assert.match(
        (error as any).processTerminationFailure.message,
        /kill not permitted/,
      );
      return true;
    },
  );
});
