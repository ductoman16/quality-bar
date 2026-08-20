import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AnalyticsView from "./analytics/AnalyticsView.vue";
import App from "./App.vue";
import { responseMessage } from "./browser.js";
import EvaluationDetailView from "./evaluations/EvaluationDetailView.vue";
import EvaluationResult from "./evaluations/EvaluationResult.vue";
import LoginView from "./LoginView.vue";
import OperatorControls from "./OperatorControls.vue";
import RepositoriesView from "./repositories/RepositoriesView.vue";
import { consumeGitHubCallbackFailure } from "./repositories/github-callback.js";
import ReviewsView from "./reviews/ReviewsView.vue";
import SystemView from "./system/SystemView.vue";

const failure = () => ({
  async json() {
    return { error: { code: "service_unavailable", message: "Unavailable" } };
  },
  ok: false,
  status: 503,
});

beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => failure()),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Vue operator views", () => {
  it("renders the fixed authenticated shell", async () => {
    const wrapper = shallowMount(App, {
      props: {
        authenticated: true,
        csrfCookieName: "quality_bar_csrf",
        view: "repositories",
      },
    });
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe("Repositories");
    expect(wrapper.findAll("nav a").map((link) => link.text())).toEqual([
      "Evaluations",
      "Reviews",
      "Repositories",
      "Analytics",
      "System",
    ]);
    expect(wrapper.get('a[aria-current="page"]').text()).toBe("Repositories");
    wrapper.unmount();
  });

  it("surfaces an invalid System attention document", async () => {
    vi.mocked(fetch).mockResolvedValue({ json: async () => ({}), ok: true });
    const wrapper = shallowMount(App, {
      props: { authenticated: true, view: "evaluations" },
    });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "system_document_invalid",
    );
    wrapper.unmount();
  });

  it("focuses the login error returned by the API", async () => {
    const wrapper = mount(LoginView, { attachTo: document.body });
    await wrapper.get("input").setValue("an incorrect operator password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Unavailable");
    expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    wrapper.unmount();
  });

  it("focuses fail-fast errors in every secondary view", async () => {
    for (const component of [
      RepositoriesView,
      ReviewsView,
      AnalyticsView,
      SystemView,
    ]) {
      const wrapper = mount(component, {
        attachTo: document.body,
        props: { csrfCookieName: "quality_bar_csrf" },
      });
      await flushPromises();
      const alert = wrapper.get('[role="alert"]');
      expect(alert.text()).toBe("Unavailable");
      expect(document.activeElement).toBe(alert.element);
      wrapper.unmount();
    }
  });

  it("submits operator mutations with the session CSRF token", async () => {
    document.cookie = "quality_bar_csrf=csrf-token";
    const wrapper = mount(OperatorControls, {
      attachTo: document.body,
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await wrapper.get("#password-change-current-password").setValue("current");
    await wrapper.get("#password-change-new-password").setValue("replacement");
    await wrapper.findAll("form")[0].trigger("submit");
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith("/api/v1/session/password", {
      body: JSON.stringify({
        current_password: "current",
        new_password: "replacement",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    });
    expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    wrapper.unmount();
  });

  it("surfaces a malformed successful token reveal", async () => {
    document.cookie = "quality_bar_csrf=csrf-token";
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({}),
      ok: true,
      status: 204,
    });
    const wrapper = mount(OperatorControls, {
      attachTo: document.body,
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await wrapper.get("#implementer-token-create-password").setValue("current");
    await wrapper
      .findAll("form")
      .find((form) => form.text().includes("Create implementer token"))
      .trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("token_reveal_invalid");
    expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    wrapper.unmount();
  });

  it("consumes a GitHub callback receipt once and removes it from the URL", async () => {
    history.replaceState(
      null,
      "",
      "/?view=repositories&github_connection_error=receipt-1",
    );
    vi.mocked(fetch).mockResolvedValueOnce({
      async json() {
        return { code: "manifest_failed", message: "Manifest failed" };
      },
      ok: true,
    });
    const showError = vi.fn();
    await expect(consumeGitHubCallbackFailure(showError)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/github-connections/callback-error?receipt=receipt-1",
    );
    expect(showError).toHaveBeenCalledWith("Manifest failed (manifest_failed)");
    expect(location.search).toBe("?view=repositories");
  });

  it("rejects malformed API errors", async () => {
    await expect(
      responseMessage({ json: async () => ({ error: {} }), status: 500 }),
    ).rejects.toThrow("error_response_invalid");
  });

  it("keeps the first immutable terminal result while polling status", async () => {
    vi.useFakeTimers();
    const evaluation = {
      base_commit: "a".repeat(40),
      base_selector: { type: "branch", value: "main" },
      completed_at: "2026-08-20T12:01:00.000Z",
      created_at: "2026-08-20T12:00:00.000Z",
      effective_outcome: "clear",
      exhausted_at: null,
      execution_status: "completed",
      head_commit: "b".repeat(40),
      head_selector: { type: "branch", value: "topic" },
      id: "evaluation-1",
      monitor: {
        duration_ms: 60_000,
        finding_counts: null,
        nodes: [],
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
      pre_start_attempt_count: 0,
      provenance: "explicit",
      repository: {
        id: "repository-1",
        url: "https://example.test/repository.git",
      },
      retry_error: null,
      retry_state: "ready",
    };
    const result = {
      applicability_results: [],
      completed_at: evaluation.completed_at,
      criterion_results: [],
      evaluation_id: evaluation.id,
      file_changes: [],
      findings: [],
      outcome: "clear",
      review_runs: [],
    };
    vi.mocked(fetch).mockImplementation(async (path) => ({
      json: async () =>
        String(path).endsWith("/result") ? result : evaluation,
      ok: true,
      status: 200,
    }));
    history.replaceState(
      null,
      "",
      "/?view=evaluation-detail&evaluation_id=evaluation-1",
    );
    const wrapper = mount(EvaluationDetailView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => String(path).endsWith("/result")),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => String(path).endsWith("/result")),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it("loads Review Run diagnostics when their disclosure opens", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        codex_cli_version: "1.2.3",
        completed_at: "2026-08-20T12:01:00.000Z",
        duration_ms: 900,
        process: { code: 0, kind: "exit" },
        review_run_id: "run-1",
        started_at: "2026-08-20T12:00:00.000Z",
        token_counters: {
          cached_input_tokens: 2,
          input_tokens: 3,
          output_tokens: 4,
        },
        transcript_chunks: [
          { content: "Review complete\n", sequence: 1, stream: "stdout" },
        ],
      }),
      ok: true,
      status: 200,
    });
    const wrapper = mount(EvaluationResult, {
      props: {
        evaluation: { id: "evaluation-1" },
        result: {
          applicability_results: [],
          criterion_results: [],
          file_changes: [],
          findings: [],
          outcome: "clear",
          review_runs: [
            {
              execution_status: "completed",
              id: "run-1",
              review_id: "review-1",
              review_version_id: "version-1",
              started_at: "2026-08-20T12:00:00.000Z",
            },
          ],
        },
      },
    });
    const disclosure = wrapper
      .findAll("details")
      .find((item) => item.text().includes("diagnostics"));
    disclosure.element.open = true;
    await disclosure.trigger("toggle");
    await flushPromises();
    expect(wrapper.text()).toContain("Codex CLI 1.2.3");
    expect(wrapper.get("pre").text()).toBe("Review complete");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/evaluations/evaluation-1/review-runs/run-1/diagnostics",
    );
    wrapper.unmount();
  });
});
