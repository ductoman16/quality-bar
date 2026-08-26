import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { arrangeForgejoFeedback } from "./forgejo-feedback-publication-support.ts";
import { arrangeGitHubFeedback } from "./github-feedback-publication-support.ts";

const worker = join(
  import.meta.dirname,
  "../fixtures/test-probes/provider-recovery-worker.mjs",
);

function addSecondInlineFinding(core: ReturnType<typeof openDurableCore>) {
  core.run(
    `INSERT INTO findings (
       id, evaluation_id, review_run_id, criterion_id,
       evidence, remediation, location_kind, file_change_id,
       side, start_line, end_line
     )
     SELECT ?, evaluation_id, review_run_id, criterion_id,
            evidence, remediation, location_kind, file_change_id,
            side, start_line, end_line
       FROM findings
      WHERE id = 'finding-inline'`,
    "finding-inline-2",
  );
}

export type DeliveryRow = {
  surface: string;
  source_id: string;
  attempt_count: number;
  error_code: string | null;
  error_detail: string | null;
  next_attempt_at: number;
  reconciliation_required: number;
  external_id: number | null;
};

export type FactRow = Record<string, any>;

export type WorkerOutput = {
  operations: string[];
  deliveries: DeliveryRow[];
  feedback: FactRow[];
  inline: FactRow[];
  statuses: FactRow[];
  deliveryGate: FactRow | null;
  pollingError: string | null;
  pollingFetches: number;
  pollingGate: FactRow | null;
  pollingRow: FactRow | null;
};

const cases = [
  {
    arrange: arrangeGitHubFeedback,
    provider: "github",
    pollingError: "github_api_transient_failure",
  },
  {
    arrange: arrangeForgejoFeedback,
    provider: "forgejo",
    pollingError: "forgejo_api_transient_failure",
  },
];

for (const scenario of cases) {
  test(`${scenario.provider} delivery and polling recovery persists across process restart`, (context) => {
    const directory = mkdtempSync(
      join(
        tmpdir(),
        `quality-bar-provider-recovery-process-${scenario.provider}-`,
      ),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const databasePath = join(directory, "quality-bar.sqlite3");
    const core = openDurableCore(databasePath);
    let coreClosed = false;
    context.after(() => {
      if (!coreClosed) {
        core.close();
      }
    });
    scenario.arrange(core);
    addSecondInlineFinding(core);
    core.close();
    coreClosed = true;

    const runWorker: (now: number) => WorkerOutput = (now: number) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [worker, scenario.provider, databasePath, String(now)],
          { encoding: "utf8" },
        ),
      ) as WorkerOutput;

    const first = runWorker(0);
    assert.deepEqual(first.operations, ["aggregate:create", "inline:create"]);
    assert.equal(first.pollingFetches, 1);
    assert.equal(first.pollingError, scenario.pollingError);
    const pollingRow = first.pollingRow;
    if (!first.pollingGate && !pollingRow) {
      throw new Error("provider polling failure was not persisted");
    }
    const pollingFailure = first.pollingGate ?? {
      // GitHub retains a repository-owned polling gate in the poll row.
      message: (pollingRow as FactRow).error_message,
      nextAttemptAt: (pollingRow as FactRow).next_attempt_at,
    };
    assert.equal(
      pollingFailure.message,
      scenario.provider === "github"
        ? "GitHub API request temporarily failed with HTTP 429"
        : "Forgejo pull-request polling failed with HTTP 503",
    );
    assert.deepEqual(first.feedback, [
      {
        error_code: null,
        error_detail: null,
        evaluation_id: "evaluation-1",
        external_id: null,
        publication_status: "waiting",
      },
    ]);
    assert.deepEqual(first.statuses, [
      {
        desired_state: "failure",
        error_code: null,
        error_detail: null,
        evaluation_id: "evaluation-1",
        external_id: null,
        publication_status: "waiting",
      },
    ]);
    assert.ok(first.deliveryGate);
    assert.equal(first.deliveryGate.gate_until, 60_000);
    assert.equal(pollingFailure.nextAttemptAt, 60_000);
    if (first.pollingRow) {
      assert.equal(first.pollingRow.next_attempt_at, 60_000);
      assert.equal(first.pollingRow.rate_gate_until, 60_000);
    }
    assert.deepEqual(
      first.deliveries.find(
        ({ surface, source_id }) =>
          surface === "aggregate_feedback" && source_id === "evaluation-1",
      ),
      {
        attempt_count: 1,
        error_code:
          scenario.provider === "github"
            ? "github_api_unavailable"
            : "forgejo_api_unavailable",
        error_detail:
          scenario.provider === "github"
            ? "GitHub API request could not complete"
            : "Forgejo publication route is unavailable: /api/v1/repos/operator/repository/issues/17/comments",
        external_id: null,
        next_attempt_at: 60_000,
        reconciliation_required: 1,
        source_id: "evaluation-1",
        surface: "aggregate_feedback",
      },
    );
    assert.equal(
      first.deliveries.find(
        ({ surface, source_id }) =>
          surface === "inline_feedback" && source_id === "finding-inline-2",
      )?.attempt_count,
      0,
    );
    assert.equal(
      first.deliveries.find(
        ({ surface, source_id }) =>
          surface === "inline_feedback" && source_id === "finding-inline-2",
      )?.next_attempt_at,
      0,
    );
    if (first.pollingRow) {
      assert.equal(first.pollingRow.baseline_status, "error");
    }

    const restarted = runWorker(10);
    assert.deepEqual(restarted.operations, []);
    assert.equal(restarted.pollingFetches, 0);
    assert.equal(restarted.pollingError, scenario.pollingError);
    assert.deepEqual(restarted.deliveries, first.deliveries);
    assert.deepEqual(restarted.deliveryGate, first.deliveryGate);
    assert.deepEqual(restarted.feedback, first.feedback);
    assert.deepEqual(restarted.inline, first.inline);
    assert.deepEqual(restarted.statuses, first.statuses);
    assert.deepEqual(restarted.pollingGate, first.pollingGate);
    assert.deepEqual(restarted.pollingRow, first.pollingRow);

    const recovered = runWorker(60_000);
    assert.equal(
      recovered.operations.filter(
        (operation) => operation === "aggregate:create",
      ).length,
      0,
    );
    assert.ok(recovered.operations.includes("aggregate:reconcile"));
    assert.ok(recovered.operations.includes("inline:reconcile"));
    assert.ok(recovered.operations.includes("commit:create"));
    assert.equal(recovered.pollingFetches, 1);
    assert.equal(recovered.pollingError, null);
    assert.equal(recovered.deliveryGate, null);
    assert.equal(recovered.pollingGate, null);
    assert.deepEqual(recovered.feedback, [
      {
        error_code: null,
        error_detail: null,
        evaluation_id: "evaluation-1",
        external_id: 902,
        publication_status: "succeeded",
      },
    ]);
    assert.equal(recovered.statuses[0].publication_status, "succeeded");
    assert.equal(recovered.statuses[0].error_code, null);
    if (scenario.provider === "forgejo") {
      assert.equal(recovered.statuses[0].external_id > 0, true);
    }
    assert.ok(
      recovered.inline
        .filter(({ finding_id }) =>
          ["finding-inline", "finding-inline-2"].includes(finding_id),
        )
        .every(
          ({ error_code, external_id, publication_status }) =>
            publication_status === "succeeded" &&
            error_code === null &&
            external_id !== null &&
            external_id > 0,
        ),
    );
    assert.ok(
      recovered.deliveries
        .filter(({ source_id }) =>
          ["evaluation-1", "finding-inline", "finding-inline-2"].includes(
            source_id,
          ),
        )
        .every(
          ({ error_code, external_id, reconciliation_required }) =>
            error_code === null &&
            external_id !== null &&
            external_id > 0 &&
            reconciliation_required === 0,
        ),
    );
    assert.ok(recovered.pollingRow);
    assert.equal(recovered.pollingRow.baseline_status, "complete");
    assert.equal(recovered.pollingRow.error_code, null);
    assert.equal(recovered.pollingRow.next_attempt_at, 120_000);
    assert.equal(recovered.pollingRow.rate_gate_until, null);
    assert.equal(recovered.pollingRow.snapshot, "[]");
  });
}
