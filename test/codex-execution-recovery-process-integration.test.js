import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHardStorageBoundary } from "../src/application-runtime.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { recoverCodexExecutions } from "../src/codex-execution-recovery.js";
import { prepareCodexProcess } from "../src/codex-process-supervisor.js";
import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunEvidenceService } from "../src/review-run-evidence.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

/** @param {number} processGroupId @returns {number[]} */
function readLiveProcessGroupMembers(processGroupId) {
  const snapshot = execFileSync("ps", ["-eo", "pid=,pgid=,stat="], {
    encoding: "utf8",
  });
  const liveMembers = [];
  for (const line of snapshot.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    const match = trimmedLine.match(/^(\d+)\s+(\d+)\s+(\S+)$/);
    if (!match) {
      throw new Error("ps returned a malformed process row");
    }
    if (Number(match[2]) !== processGroupId || match[3].startsWith("Z")) {
      continue;
    }
    liveMembers.push(Number(match[1]));
  }
  return liveMembers;
}

/** @param {number} processGroupId @returns {Promise<void>} */
async function assertProcessGroupHasNoLiveMembers(processGroupId) {
  const deadline = Date.now() + 2_000;
  let liveMembers;
  do {
    liveMembers = readLiveProcessGroupMembers(processGroupId);
    if (liveMembers.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.deepEqual(liveMembers, []);
}

test("hard storage failure terminates the supervised Codex process group", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-storage-process-group-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const boundary = createHardStorageBoundary(
    () => {},
    () => {},
  );
  const marker = join(directory, "codex-started");
  const prepared = prepareCodexProcess(
    process.execPath,
    [
      join(import.meta.dirname, "../fixtures/test-probes/mark-and-idle.mjs"),
      marker,
    ],
    { cwd: directory, environment: {} },
    process.execPath,
    (command, arguments_, options) => {
      const child = spawn(command, arguments_, options);
      boundary.registerCodexProcess(child, {
        processGroup: options.detached === true,
      });
      return child;
    },
  );
  const { child } = prepared;
  assert.ok(child.pid);
  context.after(() => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          String(error.code) === "ESRCH"
        )
      ) {
        throw error;
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
      () => reject(new Error("supervised Codex process group survived")),
      2_000,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });

  boundary.enter(failure);

  await exited;
  assert.throws(
    () => process.kill(-(/** @type {number} */ (child.pid)), 0),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      String(error.code) === "ESRCH",
  );
  assert.equal(boundary.failure, failure);
});

test("hard storage failure force-kills a resistant supervised process group", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-storage-process-group-force-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const boundary = createHardStorageBoundary(
    () => {},
    () => {},
  );
  const marker = join(directory, "codex-started");
  const prepared = prepareCodexProcess(
    process.execPath,
    [
      join(
        import.meta.dirname,
        "../fixtures/test-probes/ignore-term-and-mark.mjs",
      ),
      marker,
    ],
    { cwd: directory, environment: {} },
    process.execPath,
    (command, arguments_, options) => {
      const child = spawn(command, arguments_, options);
      boundary.registerCodexProcess(child, {
        processGroup: options.detached === true,
      });
      return child;
    },
  );
  const { child } = prepared;
  assert.ok(child.pid);
  context.after(() => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          String(error.code) === "ESRCH"
        )
      ) {
        throw error;
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
      () => reject(new Error("resistant Codex process group survived")),
      7_000,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  boundary.enter(
    Object.assign(new Error("SQLite durable write failed"), {
      code: "storage_unavailable",
    }),
  );

  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
  await assertProcessGroupHasNoLiveMembers(/** @type {number} */ (child.pid));
});

test("restart terminates a tracked surviving process group and retains its partial transcript", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-process-recovery-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "interrupted-process-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const marker = join(directory, "codex-started");
  const prepared = prepareCodexProcess(
    process.execPath,
    [
      join(import.meta.dirname, "../fixtures/test-probes/mark-and-idle.mjs"),
      marker,
    ],
    { cwd: directory, environment: {} },
    process.execPath,
  );
  const { child } = prepared;
  assert.ok(child.pid);
  context.after(() => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          String(error.code) === "ESRCH"
        )
      ) {
        throw error;
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(existsSync(marker), false);
  claims.startTracked(claim, "0.145.0", child.pid);
  createReviewRunEvidenceService(core).appendTranscriptChunk(
    claim,
    "stdout",
    '{"type":"item.completed","partial":true}\n',
  );
  await prepared.start();
  const launchDeadline = Date.now() + 2_000;
  while (!existsSync(marker) && Date.now() < launchDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(existsSync(marker), true);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("tracked process group survived recovery")),
      2_000,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  recoverCodexExecutions(core, { now: () => 30 });
  await exited;

  assert.deepEqual(
    core.get(
      `SELECT process_group_id, recovery_termination_signal, recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    {
      process_group_id: child.pid,
      recovered_at: 30,
      recovery_termination_signal: "SIGTERM",
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT sequence, stream, content
       FROM review_run_transcript_chunks
       WHERE review_run_id = 'review-run-1'`,
    ),
    [
      {
        content: '{"type":"item.completed","partial":true}\n',
        sequence: 1,
        stream: "stdout",
      },
    ],
  );
  assert.equal(
    core.get("SELECT error_code FROM review_runs WHERE id = 'review-run-1'")
      ?.error_code,
    "unexpected_execution_failure",
  );
});

test("restart rejects a tracked process group whose identity anchor exited", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-leaderless-recovery-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "leaderless-process-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");

  const leader = spawn(
    process.execPath,
    [
      join(
        import.meta.dirname,
        "../fixtures/test-probes/leaderless-process-group.mjs",
      ),
    ],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  assert.ok(leader.pid);
  /** @type {number | undefined} */
  let descendantId;
  /** @type {Promise<void>} */
  const descendantReady = new Promise((resolve, reject) => {
    leader.once("error", reject);
    leader.once("message", (message) => {
      descendantId = /** @type {{childPid: number}} */ (message).childPid;
      resolve();
    });
  });
  context.after(() => {
    for (const target of [
      -(/** @type {number} */ (leader.pid)),
      descendantId,
    ]) {
      try {
        if (Number.isSafeInteger(target)) {
          process.kill(/** @type {number} */ (target), "SIGKILL");
        }
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            String(error.code) === "ESRCH"
          )
        ) {
          throw error;
        }
      }
    }
  });
  await descendantReady;
  claims.trackProcessGroup(claim, leader.pid);
  const leaderExited = new Promise((resolve, reject) => {
    leader.once("error", reject);
    leader.once("exit", resolve);
  });
  leader.send("exit-leader");
  await leaderExited;
  assert.doesNotThrow(() =>
    process.kill(-(/** @type {number} */ (leader.pid)), 0),
  );

  assert.throws(
    () => recoverCodexExecutions(core, { now: () => 30 }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_process_identity_unavailable",
  );
  assert.equal(
    core.get(
      `SELECT recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    )?.recovered_at,
    null,
  );
});
