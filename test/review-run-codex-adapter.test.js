import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  reviewRunCodexEnvironment,
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
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => child.emit("exit", code, signal));
  return process;
}

function processThatFailsWithJsonl() {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stdout.end('{"type":"turn.failed","error":"model failure"}\n');
    process.stderr.end("pinned Codex diagnostic\n");
    child.emit("exit", 1, null);
  });
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
          CODEX_HOME: "/var/lib/quality-bar/codex",
          HOME: "/var/lib/quality-bar",
          LANG: "en_US.UTF-8",
          PATH: "/usr/local/bin:/usr/bin",
          QUALITY_BAR_SUBMIT_PATH: "/submit",
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

test("constructs a fixed host-login-safe environment instead of inheriting application secrets", () => {
  assert.deepEqual(
    reviewRunCodexEnvironment(
      { QUALITY_BAR_SUBMIT_TOKEN: "submission-channel-token" },
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
      PATH: "/bin",
      QUALITY_BAR_SUBMIT_TOKEN: "submission-channel-token",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      TMPDIR: "/tmp",
      XDG_CONFIG_HOME: "/config",
    },
  );
});

test("disables Repository instruction discovery and requests the JSONL event protocol", () => {
  const arguments_ = reviewRunCodexArguments(run);
  assert.deepEqual(
    arguments_.slice(arguments_.indexOf("project_doc_max_bytes=0") - 1),
    [
      "--config",
      "project_doc_max_bytes=0",
      "exec",
      "--ignore-rules",
      "--json",
      "--sandbox",
      "workspace-write",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=false",
      run.prompt,
    ],
  );
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

test("preserves raw JSONL stdout and stderr when the pinned Codex process fails", async () => {
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel(),
        resultService: { submit() {} },
        run,
        spawnProcess: () => /** @type {any} */ (processThatFailsWithJsonl()),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "codex_process_failed");
      assert.equal(
        /** @type {any} */ (error.cause).stdout,
        '{"type":"turn.failed","error":"model failure"}\n',
      );
      assert.equal(
        /** @type {any} */ (error.cause).stderr,
        "pinned Codex diagnostic\n",
      );
      return true;
    },
  );
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
