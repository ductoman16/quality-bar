import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import EvaluationDetailView from "./EvaluationDetailView.vue";

const evaluation = (status = "completed") => ({
  base_commit: "a".repeat(40),
  base_selector: { type: "branch", value: "main" },
  completed_at: ["cancelled", "completed", "failed"].includes(status)
    ? "2026-08-20T12:01:00.000Z"
    : null,
  created_at: "2026-08-20T12:00:00.000Z",
  effective_outcome: status === "completed" ? "clear" : "pending",
  exhausted_at: null,
  execution_status: status,
  head_commit: "b".repeat(40),
  head_selector: { type: "branch", value: "topic" },
  id: "evaluation-1",
  monitor: {
    duration_ms: status === "completed" ? 60_000 : null,
    finding_counts: null,
    nodes: [
      {
        key: "preparing",
        kind: "system",
        label: "Preparing",
        status: status === "completed" ? "completed" : "queued",
      },
      {
        key: "finalizing",
        kind: "system",
        label: "Finalizing",
        status: status === "completed" ? "completed" : "queued",
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
  next_attempt_at: null,
  pre_start_attempt_count: 0,
  provenance: "explicit",
  repository: {
    id: "repository-1",
    url: "https://example.test/repository.git",
  },
  retry_error: null,
  retry_state: "ready",
});
const response = (body, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});
const result = (outcome = "clear") => ({
  applicability_results: [],
  completed_at: "2026-08-20T12:01:00.000Z",
  criterion_results: [],
  evaluation_id: "evaluation-1",
  file_changes: [],
  findings: [],
  outcome,
  review_runs: [],
});
const notReady = () =>
  response(
    {
      error: {
        code: "evaluation_result_not_ready",
        message: "Result not ready",
      },
    },
    409,
  );

beforeEach(() => {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "qb_csrf=csrf-token",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("focuses a missing-id error", async () => {
  history.replaceState(null, "", "/?view=evaluation-detail");
  const wrapper = mount(EvaluationDetailView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "An evaluation id is required",
  );
  expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
  wrapper.unmount();
});

it("keeps not-ready results quiet and renders system markers", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) =>
      String(path).endsWith("/result") ? notReady() : response(evaluation()),
    ),
  );
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.findAll(".qb-timeline-node--system")).toHaveLength(2);
  expect(wrapper.findAll(".qb-timeline-node__marker")).toHaveLength(2);
  wrapper.unmount();
});

it("shows the safe not-found message", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response(
        { error: { code: "evaluation_not_found", message: "Not found" } },
        404,
      ),
    ),
  );
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.get("#evaluation-detail-error").text()).toBe("Not found");
  wrapper.unmount();
});

it.each(["queued", "running", "completed", "failed", "cancelled"])(
  "renders the %s lifecycle",
  async (status) => {
    history.replaceState(
      null,
      "",
      "/?view=evaluation-detail&evaluation_id=evaluation-1",
    );
    const fetch = vi.fn(async (path) =>
      String(path).endsWith("/result")
        ? notReady()
        : response(evaluation(status)),
    );
    vi.stubGlobal("fetch", fetch);
    const wrapper = mount(EvaluationDetailView, {
      props: { csrfCookieName: "qb_csrf" },
    });
    await flushPromises();
    expect(wrapper.get("#evaluation-detail-status").text()).toBe(status);
    expect(
      fetch.mock.calls.some(([path]) => String(path).endsWith("/result")),
    ).toBe(["completed", "failed", "cancelled"].includes(status));
    wrapper.unmount();
  },
);

it.each(["completed", "cancelled"])(
  "renders a valid immutable %s result without mutation controls",
  async (status) => {
    history.replaceState(
      null,
      "",
      "/?view=evaluation-detail&evaluation_id=evaluation-1",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) =>
        String(path).endsWith("/result")
          ? response(result())
          : response(evaluation(status)),
      ),
    );
    const wrapper = mount(EvaluationDetailView, {
      props: { csrfCookieName: "qb_csrf" },
    });
    await flushPromises();
    expect(wrapper.get("#evaluation-detail-result").text()).toContain(
      "Result clear",
    );
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find("#evaluation-detail-result button").exists()).toBe(
      false,
    );
    wrapper.unmount();
  },
);

it("pauses polling while hidden and refreshes on return", async () => {
  vi.useFakeTimers();
  let hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  const fetch = vi.fn(async () => response(evaluation("queued")));
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(3);
  wrapper.unmount();
});

it("surfaces malformed terminal results", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  const fetch = vi.fn(async (path) => {
    if (String(path).endsWith("/result")) {
      return response({});
    }
    return response(evaluation());
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "evaluation_result_invalid",
  );
  wrapper.unmount();
});

it("refreshes the detail after cancellation", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  let current = evaluation("queued");
  const fetch = vi.fn(async (path, options) => {
    if (options?.method === "POST") {
      current = evaluation("cancelled");
      return response(current);
    }
    return String(path).endsWith("/result") ? notReady() : response(current);
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/evaluations/evaluation-1/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  expect(wrapper.text()).toContain("cancelled");
  wrapper.unmount();
});
