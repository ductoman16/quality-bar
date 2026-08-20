import { describe, expect, it, vi } from "vitest";

import {
  mutateEvaluation,
  nodeVisualState,
  validCollection,
  validEvaluation,
  validEvaluationResult,
  validReviewRunDiagnostics,
} from "./contract.js";
import { formatDuration } from "./duration.js";

function evaluation() {
  return {
    completed_at: null,
    created_at: "2026-08-20T12:00:00.000Z",
    effective_outcome: "pending",
    execution_status: "queued",
    id: "evaluation/1",
    monitor: {
      duration_ms: null,
      finding_counts: null,
      nodes: [
        {
          key: "preparing",
          kind: "system",
          label: "Preparing",
          status: "queued",
        },
      ],
      outcome_counts: null,
      review_counts: {
        cancelled: 0,
        completed: 0,
        failed: 0,
        queued: 0,
        running: 0,
        total: 0,
      },
    },
    repository: {
      id: "repository-1",
      url: "https://example.test/repository.git",
    },
  };
}

describe("Evaluation browser contract", () => {
  it("validates collections and sends scoped mutations", async () => {
    expect(validEvaluation(evaluation())).toBe(true);
    expect(validCollection({ items: [evaluation()], next_cursor: null })).toBe(
      true,
    );
    expect(validEvaluation({ ...evaluation(), monitor: { nodes: [] } })).toBe(
      false,
    );
    expect(nodeVisualState({ outcome: "blocking", status: "completed" })).toBe(
      "blocking",
    );
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
    await mutateEvaluation("retry", "evaluation/1", "csrf-token");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/evaluations/evaluation%2F1/retry",
      expect.objectContaining({
        headers: expect.objectContaining({
          "idempotency-key": "request-id",
          "x-quality-bar-csrf": "csrf-token",
        }),
        method: "POST",
      }),
    );
  });

  it("validates canonical outcomes and nested terminal results", () => {
    const completed = evaluation();
    completed.execution_status = "completed";
    completed.effective_outcome = "blocking";
    completed.monitor.nodes.push({
      kind: "review",
      label: "Security",
      outcome: "blocking",
      review_id: "review-1",
      review_version_id: "version-1",
      status: "completed",
    });
    completed.monitor.review_counts.completed = 1;
    completed.monitor.review_counts.total = 1;
    expect(validEvaluation(completed)).toBe(true);

    const result = {
      applicability_results: [
        {
          assignment: { scope: "installation_wide" },
          evidence: { kind: "unconditional" },
          outcome: "applicable",
          review_id: "review-1",
          review_version_id: "version-1",
        },
      ],
      completed_at: "2026-08-20T12:01:00.000Z",
      criterion_results: [
        {
          criterion_id: "criterion-1",
          outcome: "triggered",
          review_run_id: "run-1",
        },
      ],
      evaluation_id: completed.id,
      file_changes: [{ id: "change-1", patch: "@@ -1 +1 @@" }],
      findings: [
        {
          criterion_id: "criterion-1",
          evidence: "Unsafe value",
          id: "finding-1",
          impact: "blocking",
          location: {
            file_change_id: "change-1",
            kind: "line_range",
            path: "src/index.js",
            side: "head",
            start_line: 1,
            end_line: 1,
          },
          remediation: "Validate the value",
          review_run_id: "run-1",
        },
      ],
      outcome: "blocking",
      review_runs: [
        {
          evaluation_id: completed.id,
          execution_status: "completed",
          id: "run-1",
          review_id: "review-1",
          review_version_id: "version-1",
          started_at: "2026-08-20T12:00:00.000Z",
        },
      ],
    };
    expect(validEvaluationResult(result, completed.id)).toBe(true);
    expect(
      validEvaluationResult(
        {
          ...result,
          findings: [{ ...result.findings[0], location: { kind: "file" } }],
        },
        completed.id,
      ),
    ).toBe(false);
    expect(formatDuration(3_661_000)).toBe("1h 1m");
    expect(
      validReviewRunDiagnostics(
        {
          codex_cli_version: "1.2.3",
          duration_ms: 1_000,
          process: { code: 0, kind: "exit" },
          review_run_id: "run-1",
          token_counters: {
            cached_input_tokens: 2,
            input_tokens: 3,
            output_tokens: 4,
          },
          transcript_chunks: [
            { content: "complete\n", sequence: 1, stream: "stdout" },
          ],
        },
        "run-1",
      ),
    ).toBe(true);
  });
});
