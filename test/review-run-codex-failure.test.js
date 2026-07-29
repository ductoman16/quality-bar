import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { REVIEW_RUN_TERMINAL_FAILURE_CODES } from "../src/review-run-codex-failure.js";
import { ReviewRunExecutionError } from "../src/review-run-result.js";
import {
  claim,
  run,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

/** @param {unknown} event */
function processThatReports(event) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 77,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stdout.end(`${JSON.stringify(event)}\n`);
    child.emit("close", 1, null);
  });
  return process;
}

/** @param {string} stderr */
function processThatExitsWithStderr(stderr) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 78,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stderr.end(stderr);
    child.emit("close", 1, null);
  });
  return process;
}

/** @param {{failure?: Error | null, result?: "failed"}} [options] */
function channel({ failure = null, result } = {}) {
  return {
    accepted: () => false,
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => failure,
    lastValidationFailure: () => null,
    waitForResult: () =>
      result === "failed" ? Promise.resolve(result) : new Promise(() => {}),
  };
}

test("the started Review Run failure catalog is fixed", () => {
  assert.deepEqual(REVIEW_RUN_TERMINAL_FAILURE_CODES, [
    "authentication_failed",
    "configuration_unavailable",
    "deadline_exceeded",
    "cancelled_by_operator",
    "subscription_exhausted",
    "context_exhausted",
    "resource_exhausted",
    "result_not_submitted",
    "codex_process_failed",
    "codex_protocol_failed",
    "submission_failed",
    "unexpected_execution_failure",
  ]);
});

test("maps pinned Codex terminal messages once to the fixed catalog", async () => {
  const cases = [
    [
      "authentication_failed",
      "You must be logged in to use Codex. Run codex login.",
    ],
    [
      "configuration_unavailable",
      "Invalid request: the selected model is not supported.",
    ],
    [
      "subscription_exhausted",
      "You've hit your usage limit. Try again after the limit resets.",
    ],
    [
      "context_exhausted",
      "Codex ran out of room in the model's context window.",
    ],
    ["context_exhausted", "context window exceeded"],
    ["context_exhausted", "shared rollout token budget exhausted"],
    [
      "resource_exhausted",
      "Selected model is at capacity. Please try a different model.",
    ],
    [
      "unexpected_execution_failure",
      "This content was flagged for possible cybersecurity risk.",
    ],
  ];
  for (const [expectedCode, message] of cases) {
    let launches = 0;
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel: async () => channel(),
          resultService: { prepare() {} },
          run,
          spawnProcess: () => {
            launches += 1;
            return /** @type {any} */ (
              processThatReports({
                error: { message },
                type: "turn.failed",
              })
            );
          },
        }),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message, message);
        return true;
      },
    );
    assert.equal(launches, 1);
  }
});

test("rejects malformed pinned Codex terminal JSONL as a protocol failure", async () => {
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel(),
        resultService: { prepare() {} },
        run,
        spawnProcess: () =>
          /** @type {any} */ (
            processThatReports({
              error: "missing message",
              type: "turn.failed",
            })
          ),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "codex_protocol_failed");
      assert.equal(error.message, "Codex Review Run terminal event is invalid");
      return true;
    },
  );
});

test("maps pinned Codex startup stderr before the JSONL stream exists", async () => {
  const cases = [
    [
      "authentication_failed",
      "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.\n",
    ],
    [
      "configuration_unavailable",
      "Error parsing -c overrides: invalid service_tier value\n",
    ],
  ];
  for (const [expectedCode, stderr] of cases) {
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel: async () => channel(),
          resultService: { prepare() {} },
          run,
          spawnProcess: () =>
            /** @type {any} */ (processThatExitsWithStderr(stderr)),
        }),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message, stderr.trim());
        return true;
      },
    );
  }
});

test("redacts the submission credential from exact Codex failure detail", async () => {
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel(),
        resultService: { prepare() {} },
        run,
        spawnProcess: () =>
          /** @type {any} */ (
            processThatReports({
              error: {
                message:
                  "Unexpected backend failure for submission token secret",
              },
              type: "turn.failed",
            })
          ),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "unexpected_execution_failure");
      assert.equal(
        error.message,
        "Unexpected backend failure for submission token [REDACTED]",
      );
      return true;
    },
  );
});
