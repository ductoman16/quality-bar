import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService, EvaluationError } from "../src/evaluation.js";

/** @param {string} digit */
const oid = (digit) => digit.repeat(40);

test("zero-Review explicit Evaluation and Result commit atomically with durable exact replay", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-evaluation-"));
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
  let acquisitions = 0;
  let nextId = 0;
  const service = createEvaluationService(core, {
    acquireChangeset: async () => {
      acquisitions += 1;
      return { base_commit: oid("1"), head_commit: oid("2") };
    },
    createId: () => `evaluation-${++nextId}`,
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const request = {
    base: { type: "branch", value: "main" },
    head: { type: "branch", value: "topic" },
  };
  const created = await service.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "request-1",
    repositoryId: "repository-1",
    request,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.resource, {
    base_commit: oid("1"),
    base_selector: { type: "branch", value: "main" },
    completed_at: "1970-01-01T00:00:00.010Z",
    created_at: "1970-01-01T00:00:00.010Z",
    effective_outcome: "clear",
    execution_status: "completed",
    head_commit: oid("2"),
    head_selector: { type: "branch", value: "topic" },
    id: "evaluation-1",
    provenance: "explicit",
    repository: {
      id: "repository-1",
      url: "https://example.invalid/repository.git",
    },
  });
  assert.deepEqual(service.readResult("evaluation-1"), {
    applicability_results: [],
    completed_at: "1970-01-01T00:00:00.010Z",
    criterion_results: [],
    evaluation_id: "evaluation-1",
    findings: [],
    outcome: "clear",
    review_runs: [],
  });

  const replay = await service.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "request-1",
    repositoryId: "repository-1",
    request,
  });
  assert.deepEqual(replay, created);
  assert.equal(acquisitions, 1);
  const otherChannel = await service.createExplicit({
    channel: "browser_session",
    idempotencyKey: "request-1",
    repositoryId: "repository-1",
    request,
  });
  assert.equal(otherChannel.resource.id, "evaluation-2");
  assert.equal(acquisitions, 2);
  core.close();

  const reopened = openDurableCore(databasePath);
  const durableService = createEvaluationService(reopened, {
    acquireChangeset: async () => {
      throw new Error("replay must not reacquire Git");
    },
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  assert.deepEqual(
    await durableService.createExplicit({
      channel: "implementer_token",
      idempotencyKey: "request-1",
      repositoryId: "repository-1",
      request,
    }),
    created,
  );
  reopened.close();
});

test("rejected explicit Evaluation stores neither partial work nor an idempotency key", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-evaluation-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let rejectAcquisition = true;
  const service = createEvaluationService(core, {
    acquireChangeset: async () => {
      if (rejectAcquisition) {
        return Promise.reject(
          new EvaluationError(
            "evaluation_selector_not_found",
            "Selector was not found",
          ),
        );
      }
      return { base_commit: oid("3"), head_commit: oid("4") };
    },
    createId: () => "evaluation-after-rejection",
    now: () => 20,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const request = {
    base: { type: "branch", value: "missing" },
    head: { type: "branch", value: "topic" },
  };
  await assert.rejects(
    () =>
      service.createExplicit({
        channel: "browser_session",
        idempotencyKey: "reusable-key",
        repositoryId: "repository-1",
        request,
      }),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "evaluation_selector_not_found",
  );
  assert.equal(
    /** @type {{count: number}} */ (
      core.get("SELECT count(*) AS count FROM evaluations")
    ).count,
    0,
  );
  assert.equal(
    /** @type {{count: number}} */ (
      core.get("SELECT count(*) AS count FROM evaluation_idempotency")
    ).count,
    0,
  );
  rejectAcquisition = false;
  assert.equal(
    (
      await service.createExplicit({
        channel: "browser_session",
        idempotencyKey: "reusable-key",
        repositoryId: "repository-1",
        request,
      })
    ).resource.id,
    "evaluation-after-rejection",
  );
  core.close();
});

test("work-admission capacity rejection consumes no Evaluation identity or idempotency key", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-evaluation-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let available = false;
  const service = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: oid("5"),
      head_commit: oid("6"),
    }),
    createId: () => "evaluation-after-capacity",
    storageReserve: {
      assertWorkAdmissionAvailable() {
        if (!available) {
          throw Object.assign(new Error("Work admission is unavailable"), {
            code: "storage_reserve_unavailable",
          });
        }
      },
    },
  });
  const input = {
    channel: /** @type {"implementer_token"} */ ("implementer_token"),
    idempotencyKey: "capacity-key",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  };
  await assert.rejects(
    () => service.createExplicit(input),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(
    /** @type {{count: number}} */ (
      core.get("SELECT count(*) AS count FROM evaluation_idempotency")
    ).count,
    0,
  );
  available = true;
  assert.equal(
    (await service.createExplicit(input)).resource.id,
    "evaluation-after-capacity",
  );
  core.close();
});
