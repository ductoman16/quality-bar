import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AnalyticsView from "./analytics/AnalyticsView.vue";
import App from "./App.vue";
import LoginView from "./LoginView.vue";
import OperatorControls from "./OperatorControls.vue";
import RepositoriesView from "./repositories/RepositoriesView.vue";
import { consumeGitHubCallbackFailure } from "./repositories/github-callback.js";
import ReviewsView from "./reviews/ReviewsView.vue";
import SystemView from "./system/SystemView.vue";

const failure = () => ({
  async json() {
    return { error: { message: "Unavailable" } };
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
});
