import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import EvaluationsView from "./EvaluationsView.vue";

const json = (body) => ({ ok: true, status: 200, json: async () => body });
function evaluation(id = "evaluation-1") {
  return {
    base_commit: "a".repeat(40),
    base_selector: { type: "branch", value: "main" },
    completed_at: null,
    created_at: "2026-08-20T12:00:00.000Z",
    effective_outcome: "pending",
    exhausted_at: "2026-08-20T12:00:00.000Z",
    execution_status: "queued",
    head_commit: "b".repeat(40),
    head_selector: { type: "branch", value: "topic" },
    id,
    next_attempt_at: null,
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
        {
          key: "finalizing",
          kind: "system",
          label: "Finalizing",
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
    provenance: "explicit",
    pre_start_attempt_count: 3,
    repository: {
      id: "repository-1",
      url: "https://example.test/repository.git",
    },
    retry_error: { code: "checkout_failed", detail: "Checkout failed" },
    retry_state: "exhausted",
  };
}

describe("Evaluations view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders, expands, filters, and keeps polled activity behind a cue", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "qb_csrf=csrf-token",
    });
    let collection = [evaluation()];
    const fetch = vi.fn(async (path) => {
      if (path === "/api/v1/repositories") {
        return json({
          items: [
            {
              assignment_count: 0,
              credential_type: "forge_connection",
              deletion_eligible: true,
              health: "healthy",
              health_error: null,
              id: "repository-1",
              lifecycle: "enabled",
              provider: "github",
              url: "https://example.test/repository.git",
              web_url: "https://example.test/repository",
            },
          ],
          next_cursor: null,
        });
      }
      if (path === "/api/v1/system") {
        return json({
          codex_execution: {
            concurrency: { maximum_running: 4, running_count: 1 },
            queue: { count: 2 },
          },
        });
      }
      if (String(path).startsWith("/api/v1/analytics?")) {
        return json({
          evaluation_overview: {
            clear_rate: { denominator: 0, numerator: 0 },
            p95_duration_ms: null,
          },
        });
      }
      if (String(path).startsWith("/api/v1/evaluations?")) {
        return json({ items: collection, next_cursor: null });
      }
      throw new Error(`unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetch);
    const wrapper = mount(EvaluationsView, {
      props: { csrfCookieName: "qb_csrf" },
    });
    await flushPromises();
    expect(wrapper.get("[data-evaluation-id='evaluation-1']").text()).toContain(
      "repository",
    );
    await wrapper.get(".evaluation-row__toggle").trigger("click");
    expect(wrapper.find(".evaluation-expanded").exists()).toBe(true);
    expect(wrapper.get(".evaluation-expanded").text()).toContain("Finalizing");
    await wrapper.get("#evaluation-filter-status").setValue("running");
    await wrapper.get(".evaluation-filter-form").trigger("submit");
    await flushPromises();
    expect(
      fetch.mock.calls.some(([path]) =>
        String(path).includes("execution_status=running"),
      ),
    ).toBe(true);
    collection = [evaluation("evaluation-2"), evaluation()];
    const systemLoads = fetch.mock.calls.filter(
      ([path]) => path === "/api/v1/system",
    ).length;
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(wrapper.text()).toContain("New activity available");
    expect(
      fetch.mock.calls.filter(([path]) => path === "/api/v1/system").length,
    ).toBeGreaterThan(systemLoads);
    expect(wrapper.find("[data-evaluation-id='evaluation-2']").exists()).toBe(
      false,
    );
    await wrapper.get(".evaluation-list-actions button").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-evaluation-id='evaluation-2']").exists()).toBe(
      true,
    );
    collection = [
      evaluation("evaluation-2"),
      {
        ...evaluation(),
        exhausted_at: null,
        retry_error: null,
        retry_state: "ready",
      },
    ];
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(wrapper.text()).toContain("New activity available");
    wrapper.unmount();
  });

  it("keeps a failed mutation visible after authoritative refresh", async () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "qb_csrf=csrf-token",
    });
    let evaluationLoads = 0;
    let systemLoads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        if (path === "/api/v1/repositories") {
          return json({ items: [], next_cursor: null });
        }
        if (path === "/api/v1/system") {
          systemLoads += 1;
          return json({
            codex_execution: {
              concurrency: { maximum_running: 1, running_count: 0 },
              queue: { count: 0 },
            },
          });
        }
        if (String(path).startsWith("/api/v1/analytics?")) {
          return json({
            evaluation_overview: {
              clear_rate: { denominator: 0, numerator: 0 },
              p95_duration_ms: null,
            },
          });
        }
        if (String(path).startsWith("/api/v1/evaluations?")) {
          evaluationLoads += 1;
          return json({ items: [evaluation()], next_cursor: null });
        }
        if (path === "/api/v1/evaluations/evaluation-1/retry") {
          return {
            json: async () => ({
              error: {
                code: "evaluation_retry_unavailable",
                message: "Retry unavailable",
              },
            }),
            ok: false,
            status: 409,
          };
        }
        throw new Error(`unexpected request ${path}`);
      }),
    );
    const wrapper = mount(EvaluationsView, {
      attachTo: document.body,
      props: { csrfCookieName: "qb_csrf" },
    });
    await flushPromises();
    const loadsBeforeMutation = evaluationLoads;
    const statsBeforeMutation = systemLoads;
    await wrapper
      .findAll(".evaluation-actions button")
      .find((button) => button.text() === "Retry")
      .trigger("click");
    await flushPromises();
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toBe("Retry unavailable");
    expect(document.activeElement).toBe(alert.element);
    expect(evaluationLoads).toBe(loadsBeforeMutation + 1);
    expect(systemLoads).toBe(statsBeforeMutation + 1);
    wrapper.unmount();
  });
});
