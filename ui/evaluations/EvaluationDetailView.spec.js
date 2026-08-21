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
const delivery = {
  attempt_count: 1,
  connection_identity: "connection-1",
  last_attempt_at: "2026-08-20T12:01:00.000Z",
  next_attempt_at: null,
  provider_gate_error: null,
  provider_gate_until: null,
  reconciliation_required: false,
  source_identity: "evaluation-1:commit-status",
  target: "abc123",
};
const result = (outcome = "clear") => ({
  applicability_results: [
    {
      assignment: { scope: "installation_wide" },
      evidence: { kind: "unconditional" },
      outcome: "applicable",
      review_id: "review-1",
      review_version_id: "version-1",
      rule: null,
    },
  ],
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
        request_id: "request-1",
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
  const value = evaluation();
  value.monitor.nodes.splice(1, 0, {
    kind: "review",
    label: "Boundaries",
    outcome: "clear",
    review_id: "review-1",
    review_version_id: "version-1",
    status: "completed",
  });
  value.monitor.review_counts.completed = 1;
  value.monitor.review_counts.total = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) =>
      String(path).endsWith("/result") ? notReady() : response(value),
    ),
  );
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.findAll(".qb-timeline-node--system")).toHaveLength(2);
  expect(wrapper.findAll(".qb-timeline-node--review")).toHaveLength(1);
  expect(wrapper.findAll(".qb-timeline-node__marker")).toHaveLength(3);
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
        {
          error: {
            code: "evaluation_not_found",
            message: "Not found",
            request_id: "request-1",
          },
        },
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
    if (["failed", "cancelled"].includes(status)) {
      expect(wrapper.get("#evaluation-detail-duration").text()).toBe(
        "Unavailable",
      );
    }
    expect(
      fetch.mock.calls.some(([path]) => String(path).endsWith("/result")),
    ).toBe(["completed", "failed"].includes(status));
    wrapper.unmount();
  },
);

it("renders a valid immutable completed result without mutation controls", async () => {
  const status = "completed";
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  const value = evaluation(status);
  value.pull_request = { number: 42 };
  value.commit_status = {
    ...delivery,
    context: "Quality Bar",
    error: null,
    external_id: 7,
    head_commit: value.head_commit,
    publication_status: "succeeded",
    published_at: "2026-08-20T12:01:00.000Z",
    state: "success",
  };
  value.feedback = {
    aggregate: {
      ...delivery,
      error: null,
      external_id: 8,
      publication_status: "succeeded",
      published_at: "2026-08-20T12:01:00.000Z",
    },
    findings: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) =>
      String(path).endsWith("/result") ? response(result()) : response(value),
    ),
  );
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.get("#evaluation-detail-result").text()).toContain(
    "Result clear",
  );
  expect(wrapper.text()).toContain(`branch main · ${value.base_commit}`);
  expect(wrapper.text()).toContain("Pull request42");
  expect(wrapper.text()).toContain("Commit statussuccess · succeeded");
  expect(wrapper.text()).toContain("FeedbackAggregate succeeded");
  expect(wrapper.find("textarea").exists()).toBe(false);
  expect(wrapper.find("#evaluation-detail-result button").exists()).toBe(false);
  wrapper.unmount();
});

it("preserves an open result disclosure and focus while polling", async () => {
  vi.useFakeTimers();
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
        : response(evaluation()),
    ),
  );
  const wrapper = mount(EvaluationDetailView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  const disclosure = wrapper.get("#evaluation-detail-result details");
  disclosure.element.open = true;
  disclosure.get("summary").element.focus();
  await vi.advanceTimersByTimeAsync(5_000);
  await flushPromises();
  expect(disclosure.element.open).toBe(true);
  expect(document.activeElement).toBe(disclosure.get("summary").element);
  wrapper.unmount();
});

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

it("refreshes the detail after retry", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  let current = {
    ...evaluation("queued"),
    exhausted_at: "2026-08-20T12:01:00.000Z",
    retry_error: { code: "checkout_failed", detail: "Checkout failed" },
    retry_state: "exhausted",
  };
  const fetch = vi.fn(async (path, options) => {
    if (String(path).endsWith("/retry") && options?.method === "POST") {
      current = evaluation("queued");
      return response(current);
    }
    return response(current);
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Retry")
    .trigger("click");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/evaluations/evaluation-1/retry",
    expect.objectContaining({ method: "POST" }),
  );
  expect(
    wrapper.findAll("button").some((button) => button.text() === "Retry"),
  ).toBe(false);
  wrapper.unmount();
});

it("combines retry and failed authority refresh errors", async () => {
  history.replaceState(
    null,
    "",
    "/?view=evaluation-detail&evaluation_id=evaluation-1",
  );
  const current = {
    ...evaluation("queued"),
    exhausted_at: "2026-08-20T12:01:00.000Z",
    retry_error: { code: "checkout_failed", detail: "Checkout failed" },
    retry_state: "exhausted",
  };
  let loaded = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (String(path).endsWith("/retry") && options?.method === "POST") {
        return {
          json: async () => ({
            error: {
              code: "evaluation_retry_unavailable",
              message: "Retry unavailable",
              request_id: "request-1",
            },
          }),
          ok: false,
          status: 409,
        };
      }
      if (loaded) {
        throw new Error("authority failed");
      }
      loaded = true;
      return response(current);
    }),
  );
  const wrapper = mount(EvaluationDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Retry")
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "Retry unavailable; authority failed",
  );
  expect(wrapper.find(".qb-evaluation-detail-meta").exists()).toBe(false);
  wrapper.unmount();
});
