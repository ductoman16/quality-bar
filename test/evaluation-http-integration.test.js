import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

const baseCommit = "1".repeat(40);
const headCommit = "2".repeat(40);
const requestBody = {
  base: { type: "branch", value: "main" },
  head: { type: "branch", value: "topic" },
};

test("the browser creates, replays, polls, and reads complete zero-Review Evaluations", async () => {
  let nextId = 0;
  const { application, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: baseCommit,
          head_commit: headCommit,
        }),
        createId: () => `evaluation-${++nextId}`,
        now: () => 1_000,
      });
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const operatorHeaders = {
    ...(await authenticatedOperatorHeaders(request)),
    "content-type": "application/json",
    "idempotency-key": "shared-key",
  };
  const path = "/api/v1/repositories/repository-1/evaluations";
  const created = await request(path, {
    body: JSON.stringify(requestBody),
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(created.status, 201);
  assert.equal(
    created.headers.get("location"),
    "/api/v1/evaluations/evaluation-1",
  );
  const resource = /** @type {{id: string}} */ (await created.json());
  assert.equal(resource.id, "evaluation-1");

  const replayed = await request(path, {
    body: JSON.stringify(requestBody),
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(replayed.status, 201);
  assert.deepEqual(await replayed.json(), resource);

  const conflict = await request(path, {
    body: JSON.stringify({
      ...requestBody,
      head: { type: "branch", value: "other" },
    }),
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(conflict.status, 409);
  assert.equal(await responseErrorCode(conflict), "idempotency_conflict");

  const read = await request("/api/v1/evaluations/evaluation-1", {
    headers: { cookie: operatorHeaders.cookie },
  });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), resource);
  const result = await request("/api/v1/evaluations/evaluation-1/result", {
    headers: { cookie: operatorHeaders.cookie },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    applicability_results: [],
    completed_at: "1970-01-01T00:00:01.000Z",
    criterion_results: [],
    evaluation_id: "evaluation-1",
    findings: [],
    outcome: "clear",
    review_runs: [],
  });

  const machineForbidden = await request(path, {
    body: JSON.stringify(requestBody),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "machine-key",
    },
    method: "POST",
  });
  assert.equal(machineForbidden.status, 403);
  assert.equal(
    await responseErrorCode(machineForbidden),
    "authorization_forbidden",
  );
  const collection = await request("/api/v1/evaluations", {
    headers: { cookie: operatorHeaders.cookie },
  });
  assert.equal(collection.status, 200);
  assert.deepEqual(
    /** @type {{items: Array<{id: string}>}} */ (
      await collection.json()
    ).items.map(({ id }) => id),
    ["evaluation-1"],
  );
  assert.equal(
    application.durableCore.get(
      "SELECT count(*) AS count FROM evaluation_idempotency",
    )?.count,
    1,
  );
});

test("selector rejection consumes no HTTP idempotency key", async () => {
  const { application, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: baseCommit,
          head_commit: headCommit,
        }),
        createId: () => "evaluation-after-rejection",
      });
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  const headers = {
    ...(await authenticatedOperatorHeaders(request)),
    "content-type": "application/json",
    "idempotency-key": "reusable-key",
  };
  const path = "/api/v1/repositories/repository-1/evaluations";
  const rejected = await request.invalidRequest(path, {
    body: JSON.stringify({
      base: { type: "tag", value: "v1" },
      head: { type: "branch", value: "topic" },
    }),
    headers,
    method: "POST",
  });
  assert.equal(rejected.status, 422);
  assert.equal(
    await responseErrorCode(rejected),
    "evaluation_selector_invalid",
  );
  const accepted = await request(path, {
    body: JSON.stringify(requestBody),
    headers,
    method: "POST",
  });
  assert.equal(accepted.status, 201);
});
