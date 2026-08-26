import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AnalyticsView from "./analytics/AnalyticsView.vue";
import App from "./App.vue";
import { responseMessage } from "./browser.ts";
import { validBrowserConfiguration } from "./contract.ts";
import EvaluationDetailView from "./evaluations/EvaluationDetailView.vue";
import EvaluationResult from "./evaluations/EvaluationResult.vue";
import LoginView from "./LoginView.vue";
import OperatorControls from "./OperatorControls.vue";
import ProviderConnections from "./repositories/ProviderConnections.vue";
import RepositoriesView from "./repositories/RepositoriesView.vue";
import RepositoryActions from "./repositories/RepositoryActions.vue";
import RepositoryDetailView from "./repositories/RepositoryDetailView.vue";
import { consumeGitHubCallbackFailure } from "./repositories/github-callback.ts";
import ReviewsView from "./reviews/ReviewsView.vue";
import SystemView from "./system/SystemView.vue";

const failure = () => ({
  async json() {
    return {
      error: {
        code: "service_unavailable",
        message: "Unavailable",
        request_id: "request-1",
      },
    };
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
  it("rejects malformed browser configuration before mounting", () => {
    expect(
      validBrowserConfiguration({
        authenticated: false,
        intendedDestination: "/?view=reviews",
        view: "evaluations",
      }),
    ).toBe(true);
    expect(
      validBrowserConfiguration({
        authenticated: true,
        csrfCookieName: "quality_bar_csrf",
        view: "repositories",
      }),
    ).toBe(true);
    for (const invalid of [
      {},
      { authenticated: "yes", view: "evaluations" },
      { authenticated: true, view: "evaluations" },
      { authenticated: true, csrfCookieName: null, view: "system" },
      { authenticated: true, csrfCookieName: false, view: "system" },
      { authenticated: true, csrfCookieName: 12345678, view: "system" },
      {
        authenticated: false,
        intendedDestination: "https://attacker.test",
        view: "evaluations",
      },
      {
        authenticated: false,
        intendedDestination: "/",
        view: "unknown",
      },
    ]) {
      expect(validBrowserConfiguration(invalid)).toBe(false);
    }
  });

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

    const detail = shallowMount(App, {
      props: { authenticated: true, view: "evaluation-detail" },
    });
    expect(detail.get("h1").text()).toBe("Evaluation");
    expect(detail.get('a[aria-current="page"]').text()).toBe("Evaluations");
    detail.unmount();
  });

  it("surfaces an invalid System attention document", async () => {
    vi.mocked(fetch as any).mockResolvedValue({
      json: async () => ({}),
      ok: true,
      status: 200,
    });
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

  it("rejects a noncanonical successful login status", async () => {
    vi.mocked(fetch as any).mockResolvedValue({ ok: true, status: 200 });
    const wrapper = mount(LoginView, { attachTo: document.body });
    await wrapper.get("input").setValue("operator password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("login_response_invalid");
    wrapper.unmount();
  });

  it("validates a registered Repository before clearing credentials", async () => {
    document.cookie = "quality_bar_csrf=csrf-token";
    const repository = {
      credential_type: "none",
      deletion_eligible: true,
      health: "healthy",
      health_error: null,
      id: "repository-1",
      lifecycle: "enabled",
      url: "https://example.test/repository.git",
    };
    vi.mocked(fetch as any).mockImplementation(
      async (path: any, options: any) => {
        if (path === "/api/v1/repositories" && !options) {
          return {
            json: async () => ({ items: [], next_cursor: null }),
            ok: true,
          };
        }
        if (path === "/api/v1/repositories" && options) {
          return { json: async () => repository, ok: true, status: 200 };
        }
        throw new Error(`unexpected request ${path}`);
      },
    );
    const wrapper = shallowMount(RepositoriesView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    await wrapper.get("#repository-url").setValue(repository.url);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Repository registered");
    expect(
      (wrapper.get("#repository-url").element as HTMLInputElement).value,
    ).toBe("");
    wrapper.unmount();
  });

  it("combines mutation and failed Repository reconciliation errors", async () => {
    const repository = {
      credential_type: "none",
      deletion_eligible: true,
      health: "healthy",
      health_error: null,
      id: "repository-1",
      lifecycle: "enabled",
      url: "https://example.test/repository.git",
    };
    let failRefresh = false;
    vi.mocked(fetch as any).mockImplementation(async (path: any) => {
      if (path !== "/api/v1/repositories") {
        throw new Error(`unexpected request ${path}`);
      }
      if (failRefresh) {
        throw new Error("authority failed");
      }
      return {
        json: async () => ({ items: [repository], next_cursor: null }),
        ok: true,
        status: 200,
      };
    });
    const wrapper = shallowMount(RepositoriesView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    await wrapper.get(".repo-row__summary button").trigger("click");
    const actions = wrapper.getComponent(RepositoryActions);
    failRefresh = true;
    actions.vm.$emit("error", "response lost");
    actions.vm.$emit("refresh", "response lost");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "response lost; authority failed",
    );
    expect(wrapper.findComponent(RepositoryActions).exists()).toBe(false);
    expect(wrapper.find(".repo-stat-strip").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No repositories registered");
    wrapper.unmount();
  });

  it("preserves ambiguous deletion errors when Repository absence is confirmed", async () => {
    history.replaceState(
      null,
      "",
      "/?view=repository-detail&repository_id=repository-1",
    );
    const repository = {
      credential_type: "none",
      deletion_eligible: true,
      health: "healthy",
      health_error: null,
      id: "repository-1",
      lifecycle: "enabled",
      url: "https://example.test/repository.git",
    };
    let deleted = false;
    vi.mocked(fetch as any).mockImplementation(async (path: any) => {
      if (path === "/api/v1/repositories") {
        return {
          json: async () => ({
            items: deleted ? [] : [repository],
            next_cursor: null,
          }),
          ok: true,
          status: 200,
        };
      }
      if (String(path).endsWith("/guidance")) {
        return {
          json: async () => ({
            guidance_revision: `guidance-v1-${"a".repeat(43)}`,
            repository: { id: repository.id, url: repository.url },
            reviews: [],
            schema_version: 1,
          }),
          ok: true,
          status: 200,
        };
      }
      throw new Error(`unexpected request ${path}`);
    });
    const wrapper = shallowMount(RepositoryDetailView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    const actions = wrapper.getComponent(RepositoryActions);
    deleted = true;
    actions.vm.$emit("error", "response lost");
    actions.vm.$emit("refresh", "response lost");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("response lost");
    expect(wrapper.findComponent(RepositoryActions).exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not render Review counts or empty state after load failure", async () => {
    vi.mocked(fetch as any).mockRejectedValue(new Error("reviews unavailable"));
    const wrapper = shallowMount(ReviewsView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain("0 active Reviews");
    expect(wrapper.text()).not.toContain("No Reviews configured");
    wrapper.unmount();
  });

  it("keeps Review dependency errors visible across filters", async () => {
    vi.mocked(fetch as any).mockImplementation(async (path: any) =>
      path === "/api/v1/system"
        ? failure()
        : { json: async () => ({ reviews: [] }), ok: true, status: 200 },
    );
    const wrapper: any = shallowMount(ReviewsView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Unavailable");
    await wrapper
      .findAll("button")
      .find((button: any) => button.text() === "Archived")
      .trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Unavailable");
    wrapper.unmount();
  });

  it("does not let provider actions clear Repository load errors", async () => {
    const wrapper = shallowMount(RepositoriesView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await flushPromises();
    const providers = wrapper.getComponent(ProviderConnections);
    providers.vm.$emit("error", "Provider failed");
    await flushPromises();
    providers.vm.$emit("error", "");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Unavailable");
    wrapper.unmount();
  });

  it("renders loading instead of fabricated empty state", () => {
    vi.mocked(fetch as any).mockImplementation(() => new Promise(() => {}));
    const repositories = shallowMount(RepositoriesView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    const reviews = shallowMount(ReviewsView, {
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    expect(repositories.text()).toContain("Loading repositories");
    expect(repositories.text()).not.toContain("No repositories registered");
    expect(reviews.text()).toContain("Loading Reviews");
    expect(reviews.text()).not.toContain("No Reviews configured");
    repositories.unmount();
    reviews.unmount();
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
    vi.mocked(fetch as any).mockResolvedValue({
      json: async () => ({}),
      ok: true,
      status: 204,
    });
    const wrapper: any = mount(OperatorControls, {
      attachTo: document.body,
      props: { csrfCookieName: "quality_bar_csrf" },
    });
    await wrapper.get("#implementer-token-create-password").setValue("current");
    await wrapper
      .findAll("form")
      .find((form: any) => form.text().includes("Create implementer token"))
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
    vi.mocked(fetch as any).mockResolvedValueOnce({
      async json() {
        return { code: "manifest_failed", message: "Manifest failed" };
      },
      ok: true,
      status: 200,
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
      responseMessage({
        json: async () => ({ error: {} }),
        status: 500,
      } as Response),
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
      next_attempt_at: null,
      monitor: {
        duration_ms: 60_000,
        finding_counts: null,
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
    vi.mocked(fetch as any).mockImplementation(async (path: any) => ({
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
    vi.mocked(fetch as any).mockResolvedValue({
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
    const disclosure: any = wrapper
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

  it("links frozen findings back to the Evaluation detail focus URL", () => {
    const wrapper = mount(EvaluationResult, {
      props: {
        evaluation: { id: "evaluation-1" },
        result: {
          applicability_results: [],
          criterion_results: [
            {
              criterion_id: "criterion-1",
              outcome: "triggered",
              review_run_id: "run-1",
            },
          ],
          file_changes: [],
          findings: [
            {
              criterion_id: "criterion-1",
              evidence: "Evidence",
              id: "finding-1",
              impact: "blocking",
              location: {
                file_change_id: "change-1",
                kind: "whole_side",
                path: "src/index.js",
                side: "head",
              },
              remediation: "Remediate",
              review_run_id: "run-1",
            },
          ],
          outcome: "blocking",
          review_runs: [
            {
              execution_status: "completed",
              id: "run-1",
              review_id: "review-1",
              review_version_id: "version-1",
            },
          ],
        },
      },
    });
    expect(wrapper.get("a").attributes("href")).toContain(
      "view=evaluation-detail",
    );
    wrapper.unmount();
  });
});
