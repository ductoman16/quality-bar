import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  reviewRunCodexArguments,
  runReviewRunCodex,
} from "../src/review-run-codex-adapter.js";
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

/** @param {number} code @param {NodeJS.Signals | null} [signal] */
function processThatExits(code, signal = null) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => child.emit("exit", code, signal));
  return process;
}

/** @param {{accepted?: boolean, failure?: Error | null}} [options] */
function channel({ accepted = false, failure = null } = {}) {
  return {
    accepted: () => accepted,
    async close() {},
    environment: {
      QUALITY_BAR_SUBMIT_PATH: "/submit",
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => failure,
  };
}

test("constructs the pinned Codex invocation and accepts only the submission channel Result", async () => {
  /** @type {unknown[]} */
  const spawnCalls = [];
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    codexCommand: "pinned-codex",
    codexPrefixArguments: ["adapter.mjs"],
    openSubmissionChannel: async () => channel({ accepted: true }),
    resultService: { submit() {} },
    run,
    spawnProcess(command, arguments_, options) {
      spawnCalls.push([command, arguments_, options]);
      return /** @type {any} */ (processThatExits(0));
    },
  });

  assert.deepEqual(spawnCalls, [
    [
      "pinned-codex",
      ["adapter.mjs", ...reviewRunCodexArguments(run)],
      {
        cwd: "/checkout",
        env: {
          QUALITY_BAR_SUBMIT_PATH: "/submit",
          QUALITY_BAR_SUBMIT_SOCKET: "/socket",
          QUALITY_BAR_SUBMIT_TOKEN: "secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ],
  ]);
});

test("maps process completion without an accepted Result to exact owning failures", async () => {
  /** @type {[number, string][]} */
  const cases = [
    [0, "result_not_submitted"],
    [2, "codex_process_failed"],
  ];
  for (const [code, expected] of cases) {
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel: async () => channel(),
          resultService: { submit() {} },
          run,
          spawnProcess: () => /** @type {any} */ (processThatExits(code)),
        }),
      (error) =>
        error instanceof ReviewRunExecutionError && error.code === expected,
    );
  }
});

test("preserves an unexpected submission storage failure", async () => {
  const storageFailure = new Error("sqlite write failed");
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel({ failure: storageFailure }),
        resultService: { submit() {} },
        run,
        spawnProcess: () => /** @type {any} */ (processThatExits(1)),
      }),
    (error) => error === storageFailure,
  );
});
