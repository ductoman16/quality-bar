import { createIoExecutionPool } from "../src/io-execution-pool.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { cancelEvaluation } from "../src/evaluation-cancellation.js";
import { createGitHubFeedbackService } from "../src/github-feedback-service.js";
import {
  EVALUATION_SELECTION,
  readEvaluation,
} from "../src/evaluation-resource.js";
import { arrangeGitHubFeedback as arrange } from "./github-feedback-publication-support.js";

test("one append-only aggregate includes every Finding while only frozen-diff coordinates publish inline", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const { base, head } = arrange(core);
  /** @type {any[][]} */
  const aggregates = [];
  /** @type {any[][]} */
  const inlines = [];
  const service = createGitHubFeedbackService(core, {
    ioPool: createIoExecutionPool(),
    cipher: {
      decrypt() {
        return { client_id: "Iv1.client", pem: "private-key" };
      },
    },
    externalOrigin: "https://quality-bar.example",
    now: () => 10,
    verifier: {
      async publishAggregateFeedback(...parameters) {
        aggregates.push(parameters);
        return 701;
      },
      async publishInlineFeedback(...parameters) {
        inlines.push(parameters);
        return 702;
      },
      async reconcileAggregateFeedback() {
        return null;
      },
      async reconcileInlineFeedback() {
        return null;
      },
    },
  });

  await service.publishWaiting();

  assert.equal(aggregates.length, 1);
  assert.match(aggregates[0][4], /Outcome: blocking/);
  assert.match(aggregates[0][4], /finding-inline/);
  assert.match(aggregates[0][4], /finding-whole/);
  assert.match(aggregates[0][4], /finding-stale/);
  assert.match(aggregates[0][4], new RegExp(base));
  assert.match(aggregates[0][4], new RegExp(head));
  assert.equal(inlines.length, 1);
  assert.deepEqual(inlines[0].slice(1, 4), [
    73,
    { full_name: "operator/repository", id: 101 },
    17,
  ]);
  assert.deepEqual(
    {
      commit_id: inlines[0][4].commit_id,
      line: inlines[0][4].line,
      path: inlines[0][4].path,
      side: inlines[0][4].side,
      start_line: inlines[0][4].start_line,
      start_side: inlines[0][4].start_side,
    },
    {
      commit_id: head,
      line: 2,
      path: "src/example.js",
      side: "LEFT",
      start_line: 1,
      start_side: "RIGHT",
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT finding_id, publication_status, external_id
       FROM github_finding_feedback
       ORDER BY finding_id`,
    ),
    [
      {
        external_id: 702,
        finding_id: "finding-inline",
        publication_status: "succeeded",
      },
      {
        external_id: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
      },
      {
        external_id: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
      },
    ],
  );
  const resource = readEvaluation(
    core.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      "evaluation-1",
    ),
  );
  assert.deepEqual(resource.feedback, {
    aggregate: {
      attempt_count: 1,
      connection_identity: "connection-1",
      error: null,
      external_id: 701,
      last_attempt_at: "1970-01-01T00:00:00.010Z",
      next_attempt_at: null,
      provider_gate_until: null,
      provider_gate_error: null,
      publication_status: "succeeded",
      published_at: "1970-01-01T00:00:00.010Z",
      reconciliation_required: false,
      source_identity: "evaluation-1",
      target: JSON.stringify({
        body: aggregates[0][4],
        pull_request_number: 17,
        repository_id: 101,
      }),
    },
    findings: [
      {
        attempt_count: 1,
        connection_identity: "connection-1",
        error: null,
        external_id: 702,
        finding_id: "finding-inline",
        last_attempt_at: "1970-01-01T00:00:00.010Z",
        next_attempt_at: null,
        provider_gate_until: null,
        provider_gate_error: null,
        publication_status: "succeeded",
        published_at: "1970-01-01T00:00:00.010Z",
        reconciliation_required: false,
        source_identity: "finding-inline",
        target: JSON.stringify({
          body: inlines[0][4].body,
          commit_id: head,
          line: 2,
          path: "src/example.js",
          side: "LEFT",
          start_line: 1,
          start_side: "RIGHT",
          pull_request_number: 17,
          repository_id: 101,
        }),
      },
      {
        attempt_count: 0,
        connection_identity: null,
        error: null,
        external_id: null,
        finding_id: "finding-stale",
        last_attempt_at: null,
        next_attempt_at: null,
        provider_gate_until: null,
        provider_gate_error: null,
        publication_status: "aggregate_only",
        published_at: null,
        reconciliation_required: false,
        source_identity: "finding-stale",
        target: "aggregate_only",
      },
      {
        attempt_count: 0,
        connection_identity: null,
        error: null,
        external_id: null,
        finding_id: "finding-whole",
        last_attempt_at: null,
        next_attempt_at: null,
        provider_gate_until: null,
        provider_gate_error: null,
        publication_status: "aggregate_only",
        published_at: null,
        reconciliation_required: false,
        source_identity: "finding-whole",
        target: "aggregate_only",
      },
    ],
  });

  const laterHead = "3".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at, completed_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'completed', 4, 5
     )`,
    head,
    laterHead,
    head,
    laterHead,
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-2', 'repository-1', 17, ?, ?)`,
    head,
    laterHead,
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-2', 'clear', 5)",
  );
  assert.deepEqual(
    core.all(
      "SELECT evaluation_id, publication_status, external_id FROM github_feedback_bundles ORDER BY evaluation_id",
    ),
    [
      {
        evaluation_id: "evaluation-1",
        external_id: 701,
        publication_status: "succeeded",
      },
      {
        evaluation_id: "evaluation-2",
        external_id: null,
        publication_status: "waiting",
      },
    ],
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM github_feedback_bundles WHERE evaluation_id = 'evaluation-1'",
      ),
    /github_feedback_bundle_immutable/,
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM github_finding_feedback WHERE finding_id = 'finding-inline'",
      ),
    /github_finding_feedback_immutable/,
  );
});

test("cancelled automatic Evaluations admit no GitHub feedback", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core, { complete: false });

  cancelEvaluation(
    core,
    "evaluation-1",
    () => 3,
    () => {},
    (code, detail) => {
      throw Object.assign(new Error(detail), { code });
    },
  );

  assert.deepEqual(
    core.get(
      "SELECT outcome FROM evaluation_results WHERE evaluation_id = 'evaluation-1'",
    ),
    { outcome: "error" },
  );
  assert.equal(
    core.get(
      "SELECT evaluation_id FROM github_feedback_bundles WHERE evaluation_id = 'evaluation-1'",
    ),
    undefined,
  );
});

test("schema 38 adds GitHub feedback without losing the canonical waiver schema", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.transaction((transaction) => {
    for (const trigger of [
      "github_feedback_bundle_admit",
      "github_feedback_bundle_identity_update",
      "github_feedback_bundle_delete",
      "github_finding_feedback_identity_update",
      "github_finding_feedback_delete",
    ]) {
      transaction.run(`DROP TRIGGER ${trigger}`);
    }
    transaction.run("DROP TABLE github_finding_feedback");
    transaction.run("DROP TABLE github_feedback_bundles");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '38' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 38");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 47);
  assert.deepEqual(
    migrated.all(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table'
         AND name IN ('waiver_adjudications', 'github_feedback_bundles')
       ORDER BY name`,
    ),
    [{ name: "github_feedback_bundles" }, { name: "waiver_adjudications" }],
  );
});

test("retired publication materializes every Finding with exact per-surface state", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core, { connectionLifecycle: "retired" });
  const service = createGitHubFeedbackService(core, {
    ioPool: createIoExecutionPool(),
    cipher: {
      decrypt() {
        throw new Error("credential must not be read");
      },
    },
    externalOrigin: "https://quality-bar.example",
    verifier: {
      async publishAggregateFeedback() {
        throw new Error("aggregate must not publish");
      },
      async publishInlineFeedback() {
        throw new Error("inline must not publish");
      },
      async reconcileAggregateFeedback() {
        throw new Error("aggregate must not reconcile");
      },
      async reconcileInlineFeedback() {
        throw new Error("inline must not reconcile");
      },
    },
  });

  await service.publishWaiting();

  assert.deepEqual(
    core.all(
      `SELECT finding_id, publication_status, error_code, error_detail
       FROM github_finding_feedback
       ORDER BY finding_id`,
    ),
    [
      {
        error_code: "github_connection_retired",
        error_detail:
          "GitHub inline feedback publication is unavailable because the GitHub Connection is retired",
        finding_id: "finding-inline",
        publication_status: "unavailable",
      },
      {
        error_code: null,
        error_detail: null,
        finding_id: "finding-stale",
        publication_status: "aggregate_only",
      },
      {
        error_code: null,
        error_detail: null,
        finding_id: "finding-whole",
        publication_status: "aggregate_only",
      },
    ],
  );
});
