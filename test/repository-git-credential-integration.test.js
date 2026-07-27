import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { verifyRepositoryRead } from "../src/repository-git.js";

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
          credentialPipe.setEncoding("utf8");
          credentialPipe.on("data", (chunk) => {
            credentialInput += chunk;
          });
          Object.assign(child, {
            kill() {},
            stdio: [null, null, null, credentialPipe],
          });
          queueMicrotask(() => child.emit("exit", 0, null));
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
