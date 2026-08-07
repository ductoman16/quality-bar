import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import { createReviewService } from "../src/review.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("assigned Review admission preserves the exact unavailable Codex adapter error without partial work", async () => {
  const unavailableCodex = Object.assign(
    new Error("Fake Codex authentication is unavailable"),
    { code: "codex_authentication_unavailable" },
  );
  const { application, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: "1".repeat(40),
          head_commit: "2".repeat(40),
        }),
      });
    },
    validateCodexAuthentication() {
      throw unavailableCodex;
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  createReviewService(application.durableCore, { now: () => 1 }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Prove the adapter dependency boundary.",
      },
    ],
    description: "Adapter dependency proof",
    name: "Adapter boundary",
  });
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const rejected = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: {
        ...operatorHeaders,
        "idempotency-key": "adapter-unavailable",
      },
      method: "POST",
    },
  );
  assert.equal(rejected.status, 503);
  assert.equal(
    await responseErrorCode(rejected),
    "codex_authentication_unavailable",
  );
  for (const table of [
    "evaluations",
    "review_runs",
    "codex_execution_queue",
    "evaluation_idempotency",
  ]) {
    assert.equal(
      application.durableCore.get(`SELECT count(*) AS count FROM ${table}`)
        ?.count,
      0,
    );
  }
});
