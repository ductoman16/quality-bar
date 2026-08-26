import assert from "node:assert/strict";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createReviewService } from "../src/review/review.ts";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.ts";

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
      file_changes: [],
      findings: [],
      outcome: "clear",
      review_runs: [],
    },
  );
});

test("not-applicable Reviews complete without launching fake Codex", async () => {
  const unavailableCodex = Object.assign(
    new Error("Fake Codex must not be launched"),
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
        createId: () => "not-applicable-evaluation",
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
  let fact = 0;
  const reviews = createReviewService(application.durableCore, {
    createId: () => `applicability-fact-${++fact}`,
    now: () => fact,
  });
  const createdReview = reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "This Review must not run.",
      },
    ],
    description: "Fake Codex applicability proof.",
    name: "Not applicable",
  });
  reviews.setAssignment(createdReview.id, {
    repository_ids: ["repository-1"],
    scope: "repository_set",
  });
  reviews.saveVersion(createdReview.id, {
    applicability_rule: "false",
    codex_configuration: createdReview.active_version.codex_configuration,
    criteria: createdReview.active_version.criteria.map((criterion) => ({
      id: criterion.id,
      impact: criterion.impact,
      instruction: criterion.instruction,
    })),
  });
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const response = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": "not-applicable",
      },
      method: "POST",
    },
  );
  assert.equal(response.status, 201);
  const result = (await (
    await request("/api/v1/evaluations/not-applicable-evaluation/result", {
      headers: { cookie: operatorHeaders.cookie },
    })
  ).json()) as any;
  assert.equal(result.outcome, "clear");
  assert.equal(result.review_runs.length, 0);
  assert.equal(result.applicability_results[0].outcome, "not_applicable");
  assert.deepEqual(result.applicability_results[0].assignment, {
    scope: "repository_specific",
  });
});
