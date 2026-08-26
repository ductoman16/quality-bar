import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  acceptedChannel,
  claim,
  run,
  runReviewRunCodex,
  runningProcess,
} from "./review-run-codex-adapter-support.ts";

test("a falsy provenance-binding failure cannot become a successful execution", async () => {
  const child = runningProcess(4325);
  const events: string[] = [];
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        finishProcessGroup() {
          events.push("finish");
        },
        killProcessGroup(processGroupId, signal) {
          assert.equal(processGroupId, -4325);
          if (signal === "SIGTERM") {
            events.push("terminate");
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          ...acceptedChannel(),
          bindProcessGroup() {
            events.push("bind");
            runInNewContext("throw undefined");
          },
        }),
        prepareProcess() {
          return {
            async abort() {},
            child: child as any,
            async finish() {},
            async start() {
              events.push("launch");
            },
          };
        },
        resultService: { prepare() {} },
        run,
        trackProcessGroup() {
          events.push("track");
        },
      }),
    /Codex process-group tracking failed/u,
  );
  assert.deepEqual(events, ["track", "bind", "terminate", "finish"]);
});

test("the Codex adapter tracks the detached process group before observing its terminal result", async () => {
  const child = runningProcess(4321);
  const events: string[] = [];

  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    evidenceService: {
      appendTranscriptChunk() {},
      complete() {},
    },
    finishProcessGroup() {
      events.push("finish");
    },
    killProcessGroup(processGroupId, signal) {
      assert.equal(processGroupId, -4321);
      if (signal === "SIGTERM") {
        events.push("terminate");
        queueMicrotask(() => child.emit("close", 0, null));
        return;
      }
      if (signal === 0) {
        throw Object.assign(new Error("process group exited"), {
          code: "ESRCH",
        });
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { prepare() {} },
    run,
    spawnProcess() {
      events.push("spawn");
      return child as any;
    },
    trackProcessGroup(processGroupId) {
      assert.equal(processGroupId, 4321);
      events.push("track");
    },
  });

  assert.deepEqual(events, ["spawn", "track", "terminate", "finish"]);
});

test("a falsy submission cleanup rejection is retained as a diagnostic failure", async () => {
  const child = runningProcess(4327);
  const channel = {
    ...acceptedChannel(),
    close: async () => Promise.reject(),
  };
  const execution = await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    finishProcessGroup() {},
    killProcessGroup(processGroupId, signal) {
      assert.equal(processGroupId, -4327);
      if (signal === "SIGTERM") {
        queueMicrotask(() => child.emit("close", 0, null));
        return;
      }
      assert.equal(signal, 0);
      throw Object.assign(new Error("process group exited"), {
        code: "ESRCH",
      });
    },
    openSubmissionChannel: async () => channel,
    prepareProcess() {
      return {
        async abort() {},
        child: child as any,
        async finish() {},
        async start() {},
      };
    },
    resultService: { prepare() {} },
    run,
    trackProcessGroup() {},
  });

  assert.equal(execution.diagnosticFailures.length, 1);
  assert.match(
    execution.diagnosticFailures[0].message,
    /submission channel cleanup failed/u,
  );
});
