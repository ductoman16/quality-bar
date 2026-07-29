import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  reviewRunCodexEnvironment,
  reviewRunCodexArguments,
} from "../src/review-run-codex-adapter.js";
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

const ownedSecrets = Object.freeze({
  forge: "forge-token-value",
  git: "git-token-value",
  implementer: "implementer-token-value",
  masterKey: "installation-master-key-value",
  operator: "operator-password-value",
  session: "browser-session-value",
  csrf: "browser-csrf-value",
});

/** @param {number} code @param {NodeJS.Signals | null} [signal] */
function processThatExits(code, signal = null) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 76,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => child.emit("close", code, signal));
  return process;
}

function processThatFailsWithJsonl() {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stdout.end(
      '{"type":"turn.failed","error":{"message":"model failure"}}\n',
    );
    process.stderr.end("pinned Codex diagnostic\n");
    child.emit("close", 1, null);
  });
  return process;
}

/**
 * @param {{
 *   accepted?: boolean,
 *   closeFailure?: Error | null,
 *   failure?: Error | null,
 *   lastValidationFailure?: ReviewRunExecutionError | null
 * }} [options]
 */
function channel({
  accepted = false,
  closeFailure = null,
  failure = null,
  lastValidationFailure = null,
} = {}) {
  return {
    accepted: () => accepted,
    async close() {
      if (closeFailure) {
        throw closeFailure;
      }
    },
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => failure,
    lastValidationFailure: () => lastValidationFailure,
    submission: () => ({ prepared: true }),
    waitForResult: () =>
      accepted ? Promise.resolve("accepted") : new Promise(() => {}),
  };
}

test("constructs the pinned Codex invocation and accepts only the submission channel Result", async () => {
  /** @type {unknown[]} */
  const spawnCalls = [];
  /** @type {string[]} */
  const launchEvents = [];
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    codexCommand: "pinned-codex",
    codexPrefixArguments: ["adapter.mjs"],
    openSubmissionChannel: async () => {
      launchEvents.push("submission-channel");
      return channel({ accepted: true });
    },
    processEnvironment: {
      CODEX_HOME: "/var/lib/quality-bar/codex",
      HOME: "/var/lib/quality-bar",
      LANG: "en_US.UTF-8",
      PATH: "/usr/local/bin:/usr/bin",
      QUALITY_BAR_FORGE_TOKEN: ownedSecrets.forge,
      QUALITY_BAR_GIT_TOKEN: ownedSecrets.git,
      QUALITY_BAR_IMPLEMENTER_TOKEN: ownedSecrets.implementer,
      QUALITY_BAR_MASTER_KEY: ownedSecrets.masterKey,
      QUALITY_BAR_OPERATOR_PASSWORD: ownedSecrets.operator,
      QUALITY_BAR_SESSION_SECRET: ownedSecrets.session,
      QUALITY_BAR_CSRF_SECRET: ownedSecrets.csrf,
    },
    resultService: { prepare() {} },
    run,
    startRun() {
      launchEvents.push("start");
    },
    spawnProcess(command, arguments_, options) {
      launchEvents.push("spawn");
      spawnCalls.push([command, arguments_, options]);
      return /** @type {any} */ (processThatExits(0));
    },
    killProcessGroup(pid, signal) {
      assert.equal(pid, -76);
      if (signal === 0) {
        throw Object.assign(new Error("process group exited"), {
          code: "ESRCH",
        });
      }
    },
  });

  assert.deepEqual(launchEvents, ["submission-channel", "start", "spawn"]);
  assert.deepEqual(spawnCalls, [
    [
      "pinned-codex",
      ["adapter.mjs", ...reviewRunCodexArguments(run)],
      {
        cwd: "/checkout",
        detached: true,
        env: {
          CODEX_HOME: "/var/lib/quality-bar/codex",
          HOME: "/var/lib/quality-bar",
          LANG: "en_US.UTF-8",
          PATH: "/submit-bin:/usr/local/bin:/usr/bin",
          QUALITY_BAR_SUBMIT_SOCKET: "/socket",
          QUALITY_BAR_SUBMIT_TOKEN: "secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ],
  ]);
  for (const secret of Object.values(ownedSecrets)) {
    assert.doesNotMatch(JSON.stringify(spawnCalls), new RegExp(secret));
  }
});

test("accepted submission closes before terminating the still-running Codex process group", async () => {
  /** @type {string[]} */
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 73,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    openSubmissionChannel: async () => ({
      ...channel({ accepted: true }),
      waitForResult: async () => {
        events.push("submission-closed");
        return "accepted";
      },
    }),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
    killProcessGroup(pid, signal) {
      assert.equal(pid, -73);
      if (signal === "SIGTERM") {
        events.push("process-terminated");
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return;
      }
      assert.equal(signal, 0);
      throw Object.assign(new Error("process group exited"), { code: "ESRCH" });
    },
  });
  assert.deepEqual(events, ["submission-closed", "process-terminated"]);
});

test("constructs a fixed host-login-safe environment instead of inheriting application secrets", () => {
  assert.deepEqual(
    reviewRunCodexEnvironment(
      { QUALITY_BAR_SUBMIT_TOKEN: "submission-channel-token" },
      "/submit-bin",
      {
        CODEX_HOME: "/codex-home",
        HOME: "/home/quality-bar",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/bin",
        SSL_CERT_FILE: "/etc/ssl/cert.pem",
        TMPDIR: "/tmp",
        XDG_CONFIG_HOME: "/config",
        QUALITY_BAR_MASTER_KEY: ownedSecrets.masterKey,
        QUALITY_BAR_SESSION_SECRET: ownedSecrets.session,
      },
    ),
    {
      CODEX_HOME: "/codex-home",
      HOME: "/home/quality-bar",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/submit-bin:/bin",
      QUALITY_BAR_SUBMIT_TOKEN: "submission-channel-token",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      TMPDIR: "/tmp",
      XDG_CONFIG_HOME: "/config",
    },
  );
});

test("disables Repository instruction discovery and requests the JSONL event protocol", () => {
  const arguments_ = reviewRunCodexArguments(run);
  assert.deepEqual(arguments_, [
    "--model",
    "gpt-5.6-terra",
    "--config",
    'model_reasoning_effort="high"',
    "--config",
    'service_tier="fast"',
    "--config",
    "project_doc_max_bytes=0",
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "--sandbox",
    "workspace-write",
    "--config",
    'approval_policy="never"',
    "--config",
    "sandbox_workspace_write.network_access=false",
    "--config",
    "shell_environment_policy.ignore_default_excludes=true",
    "--config",
    "allow_login_shell=false",
    run.prompt,
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
          resultService: { prepare() {} },
          run,
          spawnProcess: () => /** @type {any} */ (processThatExits(code)),
        }),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, expected);
        if (code !== 0) {
          const cause = /** @type {any} */ (error.cause);
          assert.deepEqual(
            {
              code: cause?.code,
              signal: cause?.signal,
              stderr: cause?.stderr,
              stdout: cause?.stdout,
            },
            {
              code,
              signal: null,
              stderr: "",
              stdout: "",
            },
          );
        }
        return true;
      },
    );
  }
});

test("every exit without acceptance preserves the last exact correction error", async () => {
  const validationFailure = new ReviewRunExecutionError(
    "criterion_result_coverage_invalid",
    "Criterion Results must cover every frozen Criterion exactly once and in order",
  );
  for (const exitCode of [0, 2]) {
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel: async () =>
            channel({ lastValidationFailure: validationFailure }),
          resultService: { prepare() {} },
          run,
          spawnProcess: () => /** @type {any} */ (processThatExits(exitCode)),
        }),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, "result_not_submitted");
        assert.equal(
          error.message,
          "Codex Review Run exited without an accepted Result; last validation error criterion_result_coverage_invalid: Criterion Results must cover every frozen Criterion exactly once and in order",
        );
        return true;
      },
    );
  }
});

test("preserves raw JSONL stdout and stderr when the pinned Codex process fails", async () => {
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel(),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (processThatFailsWithJsonl()),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "unexpected_execution_failure");
      assert.equal(error.message, "model failure");
      assert.equal(
        /** @type {any} */ (error.cause).stdout,
        '{"type":"turn.failed","error":{"message":"model failure"}}\n',
      );
      assert.equal(
        /** @type {any} */ (error.cause).stderr,
        "pinned Codex diagnostic\n",
      );
      return true;
    },
  );
});

test("channel cleanup cannot replace the exact owning process failure", async () => {
  const cleanupFailure = new Error("submission directory removal failed");
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () =>
          channel({ closeFailure: cleanupFailure }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (processThatExits(2)),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "codex_process_failed");
      assert.equal(
        /** @type {any} */ (error).submissionChannelCleanupFailure,
        cleanupFailure,
      );
      return true;
    },
  );
});

test("channel cleanup failure remains visible without overturning an accepted Result", async () => {
  const cleanupFailure = new Error("submission directory removal failed");
  assert.deepEqual(
    await runReviewRunCodex({
      checkoutPath: "/checkout",
      claim,
      openSubmissionChannel: async () =>
        channel({ accepted: true, closeFailure: cleanupFailure }),
      resultService: { prepare() {} },
      run,
      spawnProcess: () => /** @type {any} */ (processThatExits(0)),
      killProcessGroup(pid, signal) {
        assert.equal(pid, -76);
        if (signal === 0) {
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        }
      },
    }),
    { diagnosticFailures: [cleanupFailure] },
  );
});
