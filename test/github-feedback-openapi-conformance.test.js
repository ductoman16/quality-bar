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
      effective_outcome: "blocking",
      execution_status: "completed",
      feedback: {
        aggregate: {
          error: null,
          external_id: 701,
          publication_status: "succeeded",
          published_at: "2026-07-29T12:00:01.000Z",
        },
        findings: [
          {
            error: {
              code: "github_api_request_failed",
              detail: "GitHub API request failed with HTTP 403",
            },
            external_id: null,
            finding_id: "finding-1",
            publication_status: "unavailable",
            published_at: null,
          },
        ],
      },
      head_commit: head,
      head_selector: { type: "commit", value: head },
      id: "evaluation-1",
      next_attempt_at: null,
      provenance: "automatic",
      pull_request: { number: 17 },
      repository: {
        id: "repository-1",
        url: "https://github.com/operator/repository.git",
      },
    }),
  });
  assert.equal(assertion.facts().responseDocuments, 1);
});
