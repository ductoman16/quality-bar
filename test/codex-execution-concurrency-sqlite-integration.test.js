import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { createCodexExecutionConcurrencyService } from "../src/codex-execution-concurrency.js";
import { openDurableCore } from "../src/durable-core.js";
import { DurableCoreError } from "../src/durable-error.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

test("durable concurrency defaults to one and raising or lowering changes only new claims", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-concurrency-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 20,
  });
  const concurrency = createCodexExecutionConcurrencyService(core);
  assert.equal(concurrency.read(), 1);

  let worker = 0;
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => `worker-${++worker}`,
    now: () => 20,
  });
  const first = claims.claimNext();
  assert.ok(first);
  assert.equal(claims.claimNext(), undefined);

  assert.equal(concurrency.set(2), 2);
  const second = claims.claimNext();
  assert.ok(second);
  assert.notEqual(second.workId, first.workId);

  assert.equal(concurrency.set(1), 1);
  assert.equal(claims.claimNext(), undefined);
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE worker_id IS NOT NULL",
    )?.count,
    2,
  );
  core.close();

  const reopened = openDurableCore(databasePath);
  context.after(() => reopened.close());
  assert.equal(createCodexExecutionConcurrencyService(reopened).read(), 1);
  assert.throws(
    () =>
      reopened.run(
        "UPDATE codex_execution_settings SET maximum_running = 5 WHERE singleton = 1",
      ),
    /CHECK constraint failed/,
  );
  assert.equal(createCodexExecutionConcurrencyService(reopened).read(), 1);
});

test("schema 43 migrates to the default durable concurrency without changing queued work", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-concurrency-v43-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(prior, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 20,
  });
  prior.transaction((transaction) => {
    transaction.run("DROP TABLE codex_execution_settings");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '43' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 43");
  });
  prior.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 47);
  assert.equal(createCodexExecutionConcurrencyService(migrated).read(), 1);
  assert.equal(
    migrated.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
    )?.count,
    2,
  );
});

test("claiming fails with the owning error when the durable concurrency is unavailable", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-concurrency-missing-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 20,
  });
  core.run("DELETE FROM codex_execution_settings WHERE singleton = 1");
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => 20,
  });

  assert.throws(
    () => claims.claimNext(),
    (error) =>
      error instanceof DurableCoreError &&
      error.code === "codex_execution_concurrency_unavailable" &&
      error.message === "Codex execution concurrency is unavailable",
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE worker_id IS NOT NULL",
    )?.count,
    0,
  );
});
