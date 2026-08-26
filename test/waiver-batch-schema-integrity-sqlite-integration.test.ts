import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

test("queue admission seals one nonempty Waiver Adjudication Request set", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-integrity-"),
  );
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  try {
    seedCompletedEvaluation(core);
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES ('blocking-request', 'evaluation-1', 'finding-blocking', 'Contradictory', 'browser_session', 3)",
        ),
      /waiver_request_finding_ineligible/,
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at) VALUES ('mismatched-adjudication', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'queued', 3)",
          "c".repeat(40),
          "d".repeat(40),
        ),
      /waiver_adjudication_evaluation_invalid/,
    );
    for (const [id, findingId] of [
      ["selected-request", "finding-1"],
      ["late-request", "finding-2"],
    ]) {
      core.run(
        "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES (?, 'evaluation-1', ?, ?, 'browser_session', 3)",
        id,
        findingId,
        `${id} rationale`,
      );
    }
    core.run(
      "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at) VALUES ('empty-adjudication', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'queued', 3)",
      "a".repeat(40),
      "b".repeat(40),
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('empty-adjudication', 'waiver_adjudication', 3, 3)",
        ),
      /waiver_adjudication_requests_required/,
    );
    core.run(
      "UPDATE waiver_adjudications SET execution_status = 'failed', completed_at = 3, error_code = 'checkout_failed', error_detail = 'Checkout failed before Codex started' WHERE id = 'empty-adjudication'",
    );
    core.run(
      "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at, started_at, completed_at, error_code, error_detail) VALUES ('terminal-adjudication', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'failed', 3, 3, 3, 'codex_process_failed', 'Codex process failed')",
      "a".repeat(40),
      "b".repeat(40),
    );
    core.run(
      "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('terminal-adjudication', 'selected-request', 1)",
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('terminal-adjudication', 'waiver_adjudication', 3, 3)",
        ),
      /waiver_adjudication_queue_lifecycle_invalid/,
    );
    core.run(
      "INSERT INTO waiver_adjudications (id, evaluation_id, base_commit, head_commit, model, reasoning_effort, service_tier, execution_status, created_at) VALUES ('sealed-adjudication', 'evaluation-1', ?, ?, 'gpt-5.6-terra', 'high', 'standard', 'queued', 3)",
      "a".repeat(40),
      "b".repeat(40),
    );
    core.run(
      "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('sealed-adjudication', 'selected-request', 1)",
    );
    assert.throws(
      () =>
        core.run(
          "UPDATE waiver_adjudications SET requests_sealed_at = 3 WHERE id = 'sealed-adjudication'",
        ),
      /waiver_adjudication_request_seal_invalid/,
    );
    core.run(
      "INSERT INTO codex_execution_queue (work_id, work_kind, ready_at, accepted_at) VALUES ('sealed-adjudication', 'waiver_adjudication', 3, 3)",
    );
    for (const sealedAt of [null, 4]) {
      assert.throws(
        () =>
          core.run(
            "UPDATE waiver_adjudications SET requests_sealed_at = ? WHERE id = 'sealed-adjudication'",
            sealedAt,
          ),
        /waiver_adjudication_request_seal_invalid/,
      );
    }
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('sealed-adjudication', 'late-request', 2)",
        ),
      /waiver_adjudication_request_set_frozen/,
    );
    assert.throws(
      () =>
        core.run(
          "DELETE FROM codex_execution_queue WHERE work_id = 'sealed-adjudication'",
        ),
      /waiver_adjudication_queue_active/,
    );
    core.run(
      "UPDATE waiver_adjudications SET execution_status = 'failed', started_at = 3, completed_at = 4, error_code = 'codex_process_failed', error_detail = 'Codex process failed' WHERE id = 'sealed-adjudication'",
    );
    core.run(
      "DELETE FROM codex_execution_queue WHERE work_id = 'sealed-adjudication'",
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO waiver_adjudication_requests (waiver_adjudication_id, waiver_request_id, position) VALUES ('sealed-adjudication', 'late-request', 2)",
        ),
      /waiver_adjudication_request_set_frozen/,
    );
    assert.deepEqual(
      core.get(
        `SELECT waiver_adjudications.requests_sealed_at,
                count(waiver_adjudication_requests.waiver_request_id) AS request_count
         FROM waiver_adjudications
         JOIN waiver_adjudication_requests
           ON waiver_adjudication_requests.waiver_adjudication_id =
              waiver_adjudications.id
         WHERE waiver_adjudications.id = 'sealed-adjudication'`,
      ),
      { request_count: 1, requests_sealed_at: 3 },
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
