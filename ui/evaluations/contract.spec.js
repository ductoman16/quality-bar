import { describe, expect, it, vi } from "vitest";

import {
  mutateEvaluation,
  nodeVisualState,
  validCollection,
  validEvaluation,
} from "./contract.js";

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
});
