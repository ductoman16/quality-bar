import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { verifyRepositoryRead } from "../src/repository-git.js";
import { runGitCommand } from "../src/secure-git-command.js";

test("Git stdout preserves a UTF-8 code point split across chunks", async () => {
  const result = /** @type {{stdout: string, stdoutBuffer: Buffer}} */ (
    await runGitCommand({
      arguments_: ["status"],
      captureStdout: true,
      credential: undefined,
      cwd: "/",
      spawnProcess: /** @type {any} */ (
        () => {
          const child = new EventEmitter();
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          Object.assign(child, {
            kill() {},
            stderr,
            stdout,
            stdio: [null, stdout, stderr],
          });
          queueMicrotask(() => {
            stdout.write(Buffer.from([0xc3]));
            stdout.end(Buffer.from([0xa9]));
            stderr.end();
            child.emit("close", 0, null);
          });
          return child;
        }
      ),
    })
  );
  assert.equal(result.stdout, "é");
  assert.deepEqual(result.stdoutBuffer, Buffer.from("é"));
});

test("hard shutdown settles and consumes failures from both Git kill attempts", async () => {
  const workers = new AbortController();
  /** @type {NodeJS.Signals[]} */
  const signals = [];
  const completion = runGitCommand({
    arguments_: ["status"],
    captureStdout: false,
    credential: undefined,
    cwd: "/",
    signal: workers.signal,
    spawnProcess: /** @type {any} */ (
      () => {
        const child = new EventEmitter();
        const stderr = new PassThrough();
        Object.assign(child, {
          /** @param {NodeJS.Signals} signal */
          kill(signal) {
            signals.push(signal);
            queueMicrotask(() => {
              child.emit(
                "error",
                Object.assign(new Error("kill EPERM"), {
                  code: "EPERM",
                }),
              );
              if (signal === "SIGKILL") {
                queueMicrotask(() => child.emit("close", null, signal));
              }
            });
          },
          stderr,
          stdio: [null, null, stderr],
        });
        return child;
      }
    ),
    terminationGraceMs: 0,
  });
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });

  workers.abort(failure);

  await assert.rejects(completion, {
    code: "git_termination_failed",
    message: "Git process termination failed",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("private Git credentials cross only an anonymous pipe, never child environment or arguments", async () => {
  /** @type {{arguments?: string[], options?: {env?: Record<string, string>}}} */
  const captured = {};
  let credentialInput = "";
  await verifyRepositoryRead(
    "https://github.com/operator/private.git",
    { token: "installation-token-value", username: "x-access-token" },
    {
      spawnProcess: /** @type {any} */ (
        /**
         * @param {string} command
         * @param {string[]} arguments_
         * @param {{env?: Record<string, string>}} options
         */
        (command, arguments_, options) => {
          assert.equal(command, "git");
          captured.arguments = arguments_;
          captured.options = options;
          const child = new EventEmitter();
          const credentialPipe = new PassThrough();
          const stderr = new PassThrough();
          credentialPipe.setEncoding("utf8");
          credentialPipe.on("data", (chunk) => {
            credentialInput += chunk;
          });
          Object.assign(child, {
            kill() {},
            stderr,
            stdio: [null, null, stderr, credentialPipe],
          });
          queueMicrotask(() => {
            stderr.end();
            child.emit("close", 0, null);
          });
          return child;
        }
      ),
    },
  );
  assert.equal(credentialInput, "x-access-token\ninstallation-token-value\n");
  assert.doesNotMatch(
    JSON.stringify(captured),
    /installation-token-value|x-access-token/,
  );
});
