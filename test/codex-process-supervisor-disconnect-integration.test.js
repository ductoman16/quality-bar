import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { prepareCodexProcess } from "../src/codex-process-supervisor.js";

/** @param {number} processGroupId @returns {number[]} */
function readLiveProcessGroupMembers(processGroupId) {
  const snapshot = execFileSync("ps", ["-eo", "pid=,pgid=,stat="], {
    encoding: "utf8",
  });
  return snapshot
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/u))
    .filter(
      (match) =>
        match !== null &&
        Number(match[2]) === processGroupId &&
        !match[3].startsWith("Z"),
    )
    .map((match) => Number(/** @type {RegExpMatchArray} */ (match)[1]));
}

/** @param {number} processGroupId */
async function assertProcessGroupHasNoLiveMembers(processGroupId) {
  const deadline = Date.now() + 2_000;
  let liveMembers = [];
  do {
    liveMembers = readLiveProcessGroupMembers(processGroupId);
    if (liveMembers.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.deepEqual(liveMembers, []);
}

test("a disconnect-bound supervisor terminates its provider process group", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-disconnect-bound-process-group-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const marker = join(directory, "codex-started");
  const prepared = prepareCodexProcess(
    process.execPath,
    [
      join(import.meta.dirname, "../fixtures/test-probes/mark-and-idle.mjs"),
      marker,
    ],
    {
      cwd: directory,
      environment: {},
      terminateOnParentDisconnect: true,
    },
    process.execPath,
  );
  const { child } = prepared;
  assert.ok(child.pid);
  context.after(() => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        assert.equal(String(error.code), "ESRCH");
      }
    }
  });
  await prepared.start();
  const launchDeadline = Date.now() + 2_000;
  while (!existsSync(marker) && Date.now() < launchDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(existsSync(marker), true);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("disconnect-bound process group survived")),
      2_000,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  child.disconnect();
  await exited;
  await assertProcessGroupHasNoLiveMembers(/** @type {number} */ (child.pid));
});
