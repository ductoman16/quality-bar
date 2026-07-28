import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";

test("zero assigned Reviews complete clear without launching or depending on Codex", async () => {
  let acquisitions = 0;
  const unavailableCodex = Object.assign(
    new Error("Fake Codex must not be launched"),
    { code: "codex_authentication_unavailable" },
  );
  const { application, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => {
          acquisitions += 1;
          return {
            base_commit: "1".repeat(40),
            head_commit: "2".repeat(40),
          };
        },
        createId: () => "zero-review-evaluation",
        now: () => 1_000,
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
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const created = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": "zero-review",
      },
      method: "POST",
    },
  );
  assert.equal(created.status, 201);
  assert.equal(acquisitions, 1);
  assert.deepEqual(
    await (
      await request("/api/v1/evaluations/zero-review-evaluation/result", {
        headers: { cookie: operatorHeaders.cookie },
      })
    ).json(),
    {
      applicability_results: [],
      completed_at: "1970-01-01T00:00:01.000Z",
      criterion_results: [],
      evaluation_id: "zero-review-evaluation",
      findings: [],
      outcome: "clear",
      review_runs: [],
    },
  );
});
