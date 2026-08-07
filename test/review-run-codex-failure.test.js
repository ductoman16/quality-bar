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
    bindProcessGroup: () => undefined,
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_FILE: "/socket",
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
      "authentication_failed",
      "Your access token could not be refreshed. Please log out and sign in again.",
    ],
    [
      "authentication_failed",
      "Your access token could not be refreshed because it was issued to a different account. Please log out and sign in again.",
    ],
    [
      "configuration_unavailable",
      "Invalid request: the selected model is not supported.",
    ],
    ["configuration_unavailable", "Model not found gpt-5.6-terra"],
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
    [
      "authentication_failed",
      "ChatGPT login is required, but an API key is currently being used. Logging out.\n",
    ],
    [
      "authentication_failed",
      "Failed to load ChatGPT credentials while enforcing workspace restrictions: unavailable. Logging out.\n",
    ],
    [
      "authentication_failed",
      "API key login is required, but ChatGPT is currently being used. Logging out.\n",
    ],
    [
      "authentication_failed",
      "Login is restricted to workspace ws-1, but the current credentials belong to ws-2. Logging out.\n",
    ],
    [
      "authentication_failed",
      "Login is restricted to workspace ws-1, but the current credentials lack a workspace id. Logging out.\n",
    ],
    ["authentication_failed", "API key auth is missing a key\n"],
    [
      "authentication_failed",
      "failed to deserialize CLI auth: invalid stored value\n",
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

test("a post-spawn process error waits for close, transcript, and process facts", async () => {
  const processFailure = Object.assign(new Error("spawn transport failed"), {
    code: "ENOENT",
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 82,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  /** @type {unknown[]} */
  const evidence = [];
  /** @type {string[]} */
  const transcript = [];
  let terminationSignals = 0;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk(evidenceClaim, stream, content) {
            assert.deepEqual(evidenceClaim, claim);
            transcript.push(`${stream}:${content}`);
          },
          complete(evidenceClaim, facts) {
            assert.deepEqual(evidenceClaim, claim);
            evidence.push(facts);
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -82);
          if (signal === "SIGTERM") {
            terminationSignals += 1;
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => channel(),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => {
          queueMicrotask(() => {
            child.emit("error", processFailure);
            queueMicrotask(() => {
              child.stdout.end(
                '{"type":"turn.failed","error":{"message":"You must be logged in to use Codex. Run codex login."}}\n',
              );
              child.stderr.end("pinned post-error diagnostic\n");
              child.emit("close", 127, null);
            });
          });
          return /** @type {any} */ (child);
        },
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "authentication_failed");
      assert.equal(
        error.message,
        "You must be logged in to use Codex. Run codex login.",
      );
      assert.equal(
        /** @type {any} */ (error.cause).processError,
        processFailure,
      );
      return true;
    },
  );
  assert.equal(terminationSignals, 1);
  assert.deepEqual(evidence, [
    {
      exitCode: 127,
      signal: null,
      tokenCounters: {
        cached_input_tokens: null,
        input_tokens: null,
        output_tokens: null,
      },
    },
  ]);
  assert.deepEqual(transcript, [
    'stdout:{"type":"turn.failed","error":{"message":"You must be logged in to use Codex. Run codex login."}}\n',
    "stderr:pinned post-error diagnostic\n",
  ]);
});

test("a process error closes submission before termination can accept a Result", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 81,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  /** @type {(string | number)[]} */
  const events = [];
  let accepted = false;
  let closed = false;
  /** @type {(value: "accepted") => void} */
  let acceptSubmission = () => {};
  const submission = new Promise((resolve) => {
    acceptSubmission = resolve;
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        clearTerminationTimer() {},
        evidenceService: {
          appendTranscriptChunk() {},
          complete() {},
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -81);
          events.push(signal);
          if (signal === "SIGTERM") {
            accepted = !closed;
            if (accepted) {
              acceptSubmission("accepted");
            }
            queueMicrotask(() => child.emit("close", 127, null));
            return;
          }
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          ...channel(),
          accepted: () => accepted,
          async close() {
            closed = true;
            events.push("submission-closed");
          },
          environment: {},
          waitForResult: () => submission,
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess() {
          queueMicrotask(() => child.emit("error", new Error("spawn failed")));
          return /** @type {any} */ (child);
        },
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "codex_process_failed",
  );
  assert.equal(accepted, false);
  assert.deepEqual(events, ["submission-closed", "SIGTERM", 0]);
});
