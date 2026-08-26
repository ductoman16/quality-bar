import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("the first stop drains and a second stop forces the installed process", async (context) => {
  const child = spawn(
    process.execPath,
    [
      new URL(
        "../fixtures/test-probes/application-shutdown-signal.mjs",
        import.meta.url,
      ).pathname,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const waitForOutput = (expected: string) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`process did not emit ${expected}`)),
        2_000,
      );
      const inspect = () => {
        if (!output.includes(expected)) {
          setImmediate(inspect);
          return;
        }
        clearTimeout(timeout);
        resolve(undefined);
      };
      inspect();
    });
  await waitForOutput("ready\n");

  child.kill("SIGTERM");
  await waitForOutput("closing\n");
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);

  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  child.kill("SIGTERM");

  assert.deepEqual(await exited, { code: null, signal: "SIGTERM" });
});
