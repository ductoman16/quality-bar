import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_EXECUTION_LEASE_MILLISECONDS,
  CODEX_EXECUTION_RENEWAL_MILLISECONDS,
  createCodexExecutionClaimService,
} from "../src/codex/codex-execution-claim.js";

test("Codex execution claims use one oldest-ready-first selection across work kinds", () => {
  let selection = "";
  const service = createCodexExecutionClaimService(
    {
      transaction(callback) {
        return callback({
          all() {
            return [];
          },
          /** @param {string} sql */
          get(sql) {
            if (sql.includes("codex_execution_settings")) {
              return { maximum_running: 1 };
            }
            selection = sql;
            return {
              fencing_token: 0,
              work_id: "adjudication-1",
              work_kind: "waiver_adjudication",
            };
          },
          run() {
            return { changes: 1, lastInsertRowid: 0 };
          },
        });
      },
    },
    {
      createWorkerId: () => "worker-1",
      now: () => 1_000,
    },
  );

  assert.deepEqual(service.claimNext(), {
    fencingToken: 1,
    leaseExpiresAt: 121_000,
    workerId: "worker-1",
    workId: "adjudication-1",
    workKind: "waiver_adjudication",
  });
  assert.match(selection, /ORDER BY ready_at, work_id/);
  assert.match(selection, /active_queue\.work_kind = 'review_run'/);
  assert.match(selection, /active_queue\.work_kind = 'waiver_adjudication'/);
  assert.equal(CODEX_EXECUTION_RENEWAL_MILLISECONDS, 30_000);
  assert.equal(CODEX_EXECUTION_LEASE_MILLISECONDS, 120_000);
});

test("claim identities and owner-specific CLI versions must be nonblank", () => {
  const service = createCodexExecutionClaimService(
    {
      transaction() {
        assert.fail("invalid input must fail before a transaction");
      },
    },
    {
      createWorkerId: () => " ",
      now: () => 1_000,
    },
  );
  assert.throws(
    () => service.claimNext(),
    /Codex execution worker identity is invalid/,
  );
  assert.throws(
    () =>
      service.start(
        {
          fencingToken: 1,
          leaseExpiresAt: 121_000,
          workerId: "worker-1",
          workId: "review-run-1",
          workKind: "review_run",
        },
        " ",
      ),
    /Review Run Codex CLI version is invalid/,
  );
});

test("renewal loss preserves the exact owner error for both work kinds", () => {
  for (const [workKind, expectedCode, expectedMessage] of [
    [
      "review_run",
      "review_run_claim_lost",
      "Review Run claim is no longer authoritative",
    ],
    [
      "waiver_adjudication",
      "waiver_adjudication_claim_lost",
      "Waiver Adjudication claim is no longer authoritative",
    ],
  ]) {
    let renewal = () => {};
    const service = createCodexExecutionClaimService(
      {
        transaction(callback) {
          return callback({
            run() {
              return { changes: 0, lastInsertRowid: 0 };
            },
          });
        },
      },
      {
        clearInterval() {},
        createWorkerId: () => "unused",
        now: () => 60_000,
        setInterval(callback) {
          renewal = callback;
          return "renewal";
        },
      },
    );
    /** @type {{code?: string, message?: string}[]} */
    const losses = [];
    service.startRenewal(
      {
        fencingToken: 1,
        leaseExpiresAt: 120_000,
        workerId: "expired-worker",
        workId: `${workKind}-1`,
        workKind: /** @type {"review_run" | "waiver_adjudication"} */ (
          workKind
        ),
      },
      (error) =>
        losses.push(/** @type {{code?: string, message?: string}} */ (error)),
    );
    renewal();
    assert.deepEqual(
      losses.map(({ code, message }) => ({ code, message })),
      [{ code: expectedCode, message: expectedMessage }],
    );
  }
});
