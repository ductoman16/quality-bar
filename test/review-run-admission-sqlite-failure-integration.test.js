import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createEvaluationService, EvaluationError } from "../src/evaluation/evaluation.js";
import { createReviewService } from "../src/review/review.js";

test("a queue write failure rolls back the complete Review Run admission boundary", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-admission-fail-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `review-fact-${++next}`;
    })(),
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Prove SQLite rollback.",
      },
    ],
    description: "SQLite failure proof",
    name: "SQLite failure",
  });
  const failureInjectingCore = {
    ...core,
    /**
     * @template Result
     * @param {(transaction: Parameters<typeof core.transaction>[0] extends (transaction: infer Transaction) => unknown ? Transaction : never) => Result} callback
     * @returns {Result}
     */
    transaction(callback) {
      return core.transaction((transaction) =>
        callback({
          ...transaction,
          /**
           * @param {string} sql
           * @param {...import("node:sqlite").SQLInputValue} parameters
           */
          run(sql, ...parameters) {
            if (sql.includes("INSERT INTO codex_execution_queue")) {
              transaction.run("PRAGMA query_only = ON");
            }
            return transaction.run(sql, ...parameters);
          },
        }),
      );
    },
  };
  const evaluations = createEvaluationService(failureInjectingCore, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-rejected",
    createReviewRunId: () => "review-run-rejected",
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });

  await assert.rejects(
    () =>
      evaluations.createExplicit({
        channel: "implementer_token",
        idempotencyKey: "reusable-after-write-failure",
        repositoryId: "repository-1",
        request: {
          base: { type: "branch", value: "main" },
          head: { type: "branch", value: "topic" },
        },
      }),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "storage_unavailable" &&
      error.message === "SQLite durable write failed",
  );
  core.close();
  const reopened = openDurableCore(databasePath);
  context.after(() => reopened.close());
  for (const table of [
    "evaluations",
    "review_runs",
    "codex_execution_queue",
    "evaluation_idempotency",
  ]) {
    assert.equal(
      reopened.get(`SELECT count(*) AS count FROM ${table}`)?.count,
      0,
    );
  }
});
