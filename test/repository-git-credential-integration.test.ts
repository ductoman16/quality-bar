import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { verifyRepositoryRead } from "../src/repository/repository-git.ts";
import { runIoOperation } from "../src/io-operation-context.ts";
import { runGitCommand } from "../src/secure-git-command.ts";

test("Git stdout preserves a UTF-8 code point split across chunks", async () => {
  const result = (await runGitCommand({
    arguments_: ["status"],
    captureStdout: true,
    credential: undefined,
    cwd: "/",
    spawnProcess: (() => {
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
    }) as any,
  })) as { stdout: string; stdoutBuffer: Buffer };
  assert.equal(result.stdout, "é");
  assert.deepEqual(result.stdoutBuffer, Buffer.from("é"));
});

test("hard shutdown settles and consumes failures from both Git kill attempts", async () => {
  const workers = new AbortController();
  const signals: NodeJS.Signals[] = [];
  const completion = runGitCommand({
    arguments_: ["status"],
    captureStdout: false,
    credential: undefined,
    cwd: "/",
    signal: workers.signal,
    spawnProcess: (() => {
      const child = new EventEmitter();
      const stderr = new PassThrough();
      Object.assign(child, {
        kill(signal: NodeJS.Signals) {
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
    }) as any,
    terminationGraceMs: 0,
  });
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });

  workers.abort(failure);

  let terminationFailure: (AggregateError & { code?: string }) | undefined;
  await assert.rejects(completion, (error) => {
    terminationFailure = error as AggregateError & { code?: string };
    return (
      terminationFailure.code === "git_termination_failed" &&
      terminationFailure.message === "Git process termination failed"
    );
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(terminationFailure?.errors.length, 3);
  assert.equal(terminationFailure?.errors[0], failure);
  assert.deepEqual(
    terminationFailure?.errors.slice(1).map((error: any) => error.code),
    ["EPERM", "EPERM"],
  );
});

test("private Git verification preserves its hard termination failure", async () => {
  const workers = new AbortController();
  const completion = runIoOperation(workers.signal, () =>
    verifyRepositoryRead(
      "https://forgejo.example/operator/private.git",
      undefined,
      {
        spawnProcess: (() => {
          const child = new EventEmitter();
          const stderr = new PassThrough();
          Object.assign(child, {
            kill(signal: NodeJS.Signals) {
              queueMicrotask(() => {
                child.emit("error", new Error("kill EPERM"));
                queueMicrotask(() => child.emit("close", null, signal));
              });
            },
            stderr,
            stdio: [null, null, stderr],
          });
          return child;
        }) as any,
      },
    ),
  ) as Promise<any>;
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  const rejected = assert.rejects(completion, {
    code: "git_termination_failed",
    message: "Git process termination failed",
  });

  workers.abort(failure);

  await rejected;
});

test("private Git credentials cross only an anonymous pipe, never child environment or arguments", async () => {
  const captured: {
    arguments?: string[];
    options?: { env?: Record<string, string> };
  } = {};
  let credentialInput = "";
  await verifyRepositoryRead(
    "https://github.com/operator/private.git",
    { token: "installation-token-value", username: "x-access-token" },
    {
      spawnProcess: ((command: any, arguments_: any, options: any) => {
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
      }) as any,
    },
  );
  assert.equal(credentialInput, "x-access-token\ninstallation-token-value\n");
  assert.doesNotMatch(
    JSON.stringify(captured),
    /installation-token-value|x-access-token/,
  );
});
