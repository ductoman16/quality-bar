import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexExecutionRecovery,
  recoverCodexExecutions,
  terminateTrackedCodexProcessGroup,
} from "../src/codex/codex-execution-recovery.js";

const TRACKED_PROCESS = Object.freeze({
  bootIdentity: "boot-1",
  namespaceIdentity: "namespace-1",
  processGroupId: 4321,
  startIdentity: "start-1",
});

test("queued Codex work survives restart without becoming a started attempt", () => {
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "queued",
      started_at: null,
      work_kind: "review_run",
    }),
    "queued",
  );
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "queued",
      started_at: null,
      work_kind: "waiver_adjudication",
    }),
    "queued",
  );
});

test("accepted submission and durable cancellation remain terminal on restart", () => {
  for (const executionStatus of ["completed", "failed", "cancelled"]) {
    assert.equal(
      classifyCodexExecutionRecovery({
        execution_status: executionStatus,
        started_at: 20,
        work_kind: "review_run",
      }),
      "terminal",
    );
  }
});

test("a started running execution is interrupted rather than retried", () => {
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "running",
      started_at: 20,
      work_kind: "waiver_adjudication",
    }),
    "interrupted",
  );
});

test("unsupported durable recovery facts fail with their owning error", () => {
  assert.throws(
    () =>
      classifyCodexExecutionRecovery({
        execution_status: "queued",
        started_at: 20,
        work_kind: "review_run",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_recovery_state_invalid" &&
      error.message === "Codex execution recovery state is invalid",
  );
});

test("a tracked survivor receives process-group termination without reattachment", () => {
  /** @type {[number, NodeJS.Signals | 0][]} */
  const signals = [];
  let waits = 0;
  const result = terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
    killProcessGroup(processId, signal) {
      signals.push([processId, signal]);
    },
    readProcessIdentity: () => TRACKED_PROCESS,
    waitForExit: () => waits++ > 0,
  });

  assert.equal(result, "SIGKILL");
  assert.deepEqual(signals, [
    [-4321, 0],
    [-4321, "SIGTERM"],
    [-4321, "SIGKILL"],
  ]);
});

test("an already absent tracked process group remains an exact no-survivor fact", () => {
  const result = terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
    killProcessGroup() {
      throw Object.assign(new Error("missing"), { code: "ESRCH" });
    },
  });
  assert.equal(result, null);
});

test("a tracked process that exits during grace is not force-killed", () => {
  /** @type {NodeJS.Signals[]} */
  const signals = [];
  let active = true;
  const result = terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
    killProcessGroup(processId, signal) {
      assert.equal(processId, -4321);
      if (signal === 0 && !active) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
      if (signal !== 0) {
        signals.push(signal);
      }
    },
    readProcessIdentity: () => TRACKED_PROCESS,
    waitForExit(isActive) {
      active = false;
      return !isActive();
    },
  });
  assert.equal(result, "SIGTERM");
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("a reused process-group number is never signalled", () => {
  /** @type {NodeJS.Signals[]} */
  const signals = [];
  assert.throws(
    () =>
      terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
        killProcessGroup(processId, signal) {
          assert.equal(processId, -4321);
          if (signal !== 0) {
            signals.push(signal);
          }
        },
        readProcessIdentity: () => ({
          ...TRACKED_PROCESS,
          startIdentity: "different-start",
        }),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_process_identity_changed",
  );
  assert.deepEqual(signals, []);
});

test("a process group without its durable identity anchor is never signalled", () => {
  /** @type {[number, NodeJS.Signals | 0][]} */
  const signals = [];
  assert.throws(
    () =>
      terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
        killProcessGroup(processId, signal) {
          signals.push([processId, signal]);
        },
        readProcessIdentity() {
          throw Object.assign(new Error("leader exited"), { code: "ESRCH" });
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_process_identity_unavailable",
  );
  assert.deepEqual(signals, [[-4321, 0]]);
});

test("a survivor after SIGKILL remains an exact hard failure", () => {
  assert.throws(
    () =>
      terminateTrackedCodexProcessGroup(TRACKED_PROCESS, {
        hasLiveProcessGroupMember: () => true,
        killProcessGroup(processId, signal) {
          assert.equal(processId, -4321);
          assert.ok([0, "SIGTERM", "SIGKILL"].includes(signal));
        },
        readProcessIdentity: () => TRACKED_PROCESS,
        waitForExit(isActive) {
          assert.equal(isActive(), true);
          return false;
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_process_group_termination_failed",
  );
});

test("recovery releases queued work and fails an interrupted waiver without retry", () => {
  /** @type {{sql: string, parameters: unknown[]}[]} */
  const writes = [];
  const durableCore = {
    all() {
      return [
        {
          execution_status: "queued",
          process_group_finished_at: null,
          process_group_id: null,
          recovered_at: null,
          recovery_termination_signal: null,
          started_at: null,
          work_id: "review-queued",
          work_kind: "review_run",
        },
        {
          evaluation_id: null,
          execution_status: "running",
          process_boot_identity: "boot-1",
          process_group_finished_at: null,
          process_group_id: 4321,
          process_namespace_identity: "namespace-1",
          process_start_identity: "start-1",
          recovered_at: null,
          recovery_termination_signal: null,
          started_at: 20,
          work_id: "waiver-running",
          work_kind: "waiver_adjudication",
        },
      ];
    },
    transaction(/** @type {any} */ callback) {
      return callback({
        get() {
          return undefined;
        },
        /** @param {string} sql @param {any[]} parameters */
        run(sql, ...parameters) {
          writes.push({ parameters, sql });
          return { changes: 1 };
        },
      });
    },
  };
  assert.deepEqual(
    recoverCodexExecutions(durableCore, {
      now: () => 30,
      terminateProcessGroup: () => "SIGTERM",
    }),
    { interrupted: 1, queued: 1 },
  );
  assert.equal(writes.length, 3);
  assert.match(writes[0].sql, /recovery_termination_signal/);
  assert.match(writes[1].sql, /SET lease_expires_at/);
  assert.match(writes[2].sql, /execution_status = 'failed'/);
});

test("each physical termination fact commits before a later survivor fails", () => {
  /** @type {{parameters: unknown[], sql: string}[]} */
  const persisted = [];
  const work = [4321, 4322].map((processGroupId) => ({
    execution_status: "running",
    process_boot_identity: "boot-1",
    process_group_finished_at: null,
    process_group_id: processGroupId,
    process_namespace_identity: "namespace-1",
    process_start_identity: `start-${processGroupId}`,
    recovered_at: null,
    recovery_termination_signal: null,
    started_at: 20,
    work_id: `waiver-${processGroupId}`,
    work_kind: "waiver_adjudication",
  }));
  const durableCore = {
    all: () => work,
    transaction(/** @type {any} */ callback) {
      return callback({
        /** @param {string} sql @param {unknown[]} parameters */
        run(sql, ...parameters) {
          persisted.push({ parameters, sql });
          return { changes: 1 };
        },
      });
    },
  };
  assert.throws(
    () =>
      recoverCodexExecutions(durableCore, {
        now: () => 30,
        terminateProcessGroup({ processGroupId }) {
          if (processGroupId === 4322) {
            throw new Error("later termination failed");
          }
          return "SIGTERM";
        },
      }),
    new Error("later termination failed"),
  );
  assert.equal(persisted.length, 1);
  assert.match(persisted[0].sql, /recovery_termination_signal/);
  assert.deepEqual(persisted[0].parameters.slice(0, 3), [
    "SIGTERM",
    30,
    "waiver-4321",
  ]);
});

test("restart resumes owner recovery from an already durable termination fact", () => {
  /** @type {string[]} */
  const writes = [];
  const durableCore = {
    all: () => [
      {
        execution_status: "running",
        process_group_finished_at: null,
        process_group_id: 4321,
        recovered_at: 30,
        recovery_termination_signal: "SIGTERM",
        started_at: 20,
        work_id: "waiver-running",
        work_kind: "waiver_adjudication",
      },
    ],
    transaction(/** @type {any} */ callback) {
      return callback({
        /** @param {string} sql */
        run(sql) {
          writes.push(sql);
          return { changes: 1 };
        },
      });
    },
  };
  assert.deepEqual(
    recoverCodexExecutions(durableCore, {
      now: () => 40,
      terminateProcessGroup: () =>
        assert.fail("durably terminated work was signalled again"),
    }),
    { interrupted: 1, queued: 0 },
  );
  assert.equal(writes.length, 1);
  assert.match(writes[0], /execution_status = 'failed'/);
});

test("recovery fails when durable interrupted authority changes", () => {
  const durableCore = {
    all: () => [
      {
        execution_status: "running",
        process_group_finished_at: 25,
        process_group_id: null,
        recovered_at: null,
        recovery_termination_signal: null,
        started_at: 20,
        work_id: "waiver-running",
        work_kind: "waiver_adjudication",
      },
    ],
    transaction(/** @type {any} */ callback) {
      return callback({ run: () => ({ changes: 0 }) });
    },
  };
  assert.throws(
    () => recoverCodexExecutions(durableCore, { now: () => 30 }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_recovery_state_changed",
  );
});
