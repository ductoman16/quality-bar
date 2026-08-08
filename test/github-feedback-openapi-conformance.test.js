import assert from "node:assert/strict";
import { test } from "node:test";

import { createHttpConformanceAssertion } from "../scripts/openapi-conformance.mjs";
import { canonicalOpenApiDocument } from "../src/canonical-api.js";

test("runtime conformance accepts exact aggregate and per-Finding feedback state", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  const base = "1".repeat(40);
  const head = "2".repeat(40);
  await assertion.assertExchange({
    request: {
      method: "GET",
      url: "http://127.0.0.1/api/v1/evaluations/evaluation-1",
    },
    response: Response.json({
      base_commit: base,
      base_selector: { type: "commit", value: base },
      completed_at: "2026-07-29T12:00:00.000Z",
      created_at: "2026-07-29T11:00:00.000Z",
      monitor: {
        duration_ms: 3_600_000,
        finding_counts: { advisory: 0, blocking: 1, total: 1 },
        nodes: [
          {
            key: "preparing",
            kind: "system",
            label: "Preparing",
            status: "completed",
          },
          {
            key: "finalizing",
            kind: "system",
            label: "Finalizing",
            status: "completed",
          },
        ],
        outcome_counts: { clear: 0, error: 0, not_applicable: 0, triggered: 1 },
        review_counts: {
          cancelled: 0,
          completed: 1,
          failed: 0,
          queued: 0,
          running: 0,
          total: 1,
        },
      },
      effective_outcome: "blocking",
      execution_status: "completed",
      exhausted_at: null,
      feedback: {
        aggregate: {
          attempt_count: 1,
          connection_identity: "connection-1",
          error: null,
          external_id: 701,
          last_attempt_at: "2026-07-29T12:00:00.000Z",
          next_attempt_at: null,
          publication_status: "succeeded",
          published_at: "2026-07-29T12:00:01.000Z",
          provider_gate_until: null,
          provider_gate_error: null,
          reconciliation_required: false,
          source_identity: "evaluation-1",
          target: '{"pull_request_number":17,"repository_id":101}',
        },
        findings: [
          {
            attempt_count: 1,
            connection_identity: "connection-1",
            error: {
              code: "github_api_request_failed",
              detail: "GitHub API request failed with HTTP 403",
            },
            external_id: null,
            finding_id: "finding-1",
            last_attempt_at: "2026-07-29T12:00:00.000Z",
            next_attempt_at: null,
            publication_status: "unavailable",
            published_at: null,
            provider_gate_until: null,
            provider_gate_error: null,
            reconciliation_required: false,
            source_identity: "finding-1",
            target: '{"pull_request_number":17,"repository_id":101}',
          },
        ],
      },
      head_commit: head,
      head_selector: { type: "commit", value: head },
      id: "evaluation-1",
      next_attempt_at: null,
      pre_start_attempt_count: 0,
      provenance: "automatic",
      pull_request: { number: 17 },
      retry_error: null,
      retry_state: "ready",
      repository: {
        id: "repository-1",
        url: "https://github.com/operator/repository.git",
      },
    }),
  });
  assert.equal(assertion.facts().responseDocuments, 1);
});
