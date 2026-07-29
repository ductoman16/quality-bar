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
