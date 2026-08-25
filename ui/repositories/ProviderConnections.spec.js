import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ProviderConnections from "./ProviderConnections.vue";
import ProviderConnectionFacts from "./ProviderConnectionFacts.vue";
import {
  validForgejoChoices,
  validForgejoConnection,
  validGitHubSelection,
  validManifestContinuation,
} from "./contract.js";
import {
  reconciledGitHubSelection,
  registerGitHubSelection,
} from "./github-selection.js";

const connection = {
  api_profile: "forgejo",
  base_url: "https://forgejo.example",
  capabilities: {},
  health: "healthy",
  health_error: null,
  id: "forgejo-connection",
  lifecycle: "enabled",
  polling: [
    {
      baseline_status: "complete",
      error: null,
      forge_repository_id: 11,
      last_success_at: 1_000,
      next_attempt_at: null,
      rate_gate_until: 2_000,
    },
  ],
  polling_failure: null,
  principal: { id: 7, login: "operator" },
  reported_version: "16.0.4",
  scopes: ["read:repository", "write:issue", "write:repository"],
  verification_history: [
    {
      api_profile: "forgejo",
      capabilities: {},
      error: null,
      id: "verification-1",
      outcome: "success",
      principal: { id: 7, login: "operator" },
      reported_version: "16.0.4",
      repositories: [
        {
          api_url: "https://forgejo.example/api/v1/repos/operator/repository",
          clone_url: "https://forgejo.example/operator/repository.git",
          full_name: "operator/repository",
          html_url: "https://forgejo.example/operator/repository",
          id: 11,
          outcome: "success",
          permissions: { admin: true, pull: true, push: true },
          private: true,
        },
      ],
      scopes: ["read:repository", "write:issue", "write:repository"],
      trigger: "onboarding",
      verified_at: 1_000,
    },
  ],
  verified_at: 1_000,
};

beforeEach(() => {
  HTMLFormElement.prototype.submit = vi.fn();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "qb_csrf=csrf-token",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (
        path === "/api/v1/github-connections" ||
        (path === "/api/v1/forgejo-connections" && !options)
      ) {
        return { json: async () => null, ok: true, status: 200 };
      }
      if (path === "/api/v1/forgejo-connections/discover") {
        return {
          json: async () => [{ full_name: "operator/repository", id: 11 }],
          ok: true,
          status: 200,
        };
      }
      if (path === "/api/v1/forgejo-connections" && options) {
        return { json: async () => connection, ok: true, status: 201 };
      }
      throw new Error(`unexpected request ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("renders provider error evidence", () => {
  const shared = {
    api_profile: "profile",
    capabilities: {},
    lifecycle: "enabled",
    polling: [],
    polling_failure: null,
    principal: { id: 7, login: "operator" },
  };
  const forgejo = mount(ProviderConnectionFacts, {
    props: {
      connection: {
        ...shared,
        health: "error",
        health_error: { code: "connection_failed", message: "Unavailable" },
        reported_version: "16.0.4",
        scopes: [],
        verification_history: [
          {
            capabilities: null,
            error: { code: "verification_failed", message: "Rejected" },
            id: "verification-1",
            outcome: "error",
            principal: null,
            repositories: [
              {
                error: { code: "repository_failed", message: "Denied" },
                forge_repository_id: 11,
                outcome: "error",
              },
            ],
            scopes: null,
            trigger: "rotation",
            verified_at: 1_000,
          },
        ],
      },
      provider: "Forgejo",
    },
  });
  expect(forgejo.text()).toContain("Unavailable (connection_failed)");
  expect(forgejo.text()).toContain("Denied (repository_failed)");
  forgejo.unmount();
  const github = mount(ProviderConnectionFacts, {
    props: {
      connection: {
        ...shared,
        health: "healthy",
        health_error: null,
        permissions: {},
        verification_history: [
          {
            capabilities: null,
            error: {
              code: "repository_failed",
              message: "Rejected",
              repository_id: 12,
            },
            id: "verification-1",
            outcome: "error",
            permissions: null,
            principal: null,
            repository_checks: [],
            trigger: "rotation",
            verified_at: 1_000,
          },
        ],
      },
      provider: "GitHub",
    },
  });
  expect(github.text()).toContain("Repository 12");
  github.unmount();
});

it("validates discovery and submits a Forgejo Connection mutation", async () => {
  expect(
    validForgejoConnection({
      ...connection,
      base_url: "http://forgejo.local",
    }),
  ).toBe(true);
  const failed = structuredClone(connection);
  failed.verification_history[0].repositories[0].outcome = "error";
  expect(validForgejoConnection(failed)).toBe(false);
  const openPrincipal = structuredClone(connection);
  openPrincipal.principal.display_name = "Operator";
  expect(validForgejoConnection(openPrincipal)).toBe(true);
  expect(
    validForgejoConnection({ ...connection, reported_version: 16.04 }),
  ).toBe(false);
  expect(
    validForgejoChoices([
      { full_name: "operator/repository", id: 11, private: true },
    ]),
  ).toBe(true);
  const wrapper = mount(ProviderConnections, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .get("#forgejo-connection-base-url")
    .setValue("https://forgejo.example");
  await wrapper.get("#forgejo-connection-token").setValue("token");
  await wrapper.get("#forgejo-connection-form").trigger("submit");
  await flushPromises();
  await wrapper.get('input[type="checkbox"]').setValue(true);
  const registration = wrapper
    .findAll("form")
    .find((form) => form.text().includes("Register selected Forgejo"));
  expect(registration).toBeTruthy();
  await registration.trigger("submit");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith("/api/v1/forgejo-connections", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "token",
    }),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": "csrf-token",
    },
    method: "POST",
  });
  expect(wrapper.text()).toContain("Forgejo Connection verified");
  expect(wrapper.text()).toContain("API profile");
  expect(wrapper.text()).toContain("Required authorities");
  expect(wrapper.text()).toContain("Verification history");
  expect(wrapper.text()).toContain("Repository checks");
  expect(wrapper.text()).toContain("Polling");
  expect(wrapper.text()).toContain("rate gate");
  expect(document.activeElement).toBe(wrapper.get("output").element);
  wrapper.unmount();
});

it("accepts only the state-bound GitHub manifest action", () => {
  const value = {
    action: "https://github.com/settings/apps/new?state=manifest-state",
    manifest: { default_events: [], public: false },
    method: "POST",
    state: "manifest-state",
  };
  expect(validManifestContinuation(value)).toBe(true);
  expect(
    validManifestContinuation({
      ...value,
      action: "https://attacker.example/collect",
    }),
  ).toBe(false);
  expect(validManifestContinuation({ ...value, state: 12345678 })).toBe(false);
});

it("starts the GitHub App manifest flow with its canonical response", async () => {
  const continuation = {
    action: "https://github.com/settings/apps/new?state=manifest-state",
    manifest: { default_events: [], public: false },
    method: "POST",
    state: "manifest-state",
  };
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (
      path === "/api/v1/github-connections" ||
      (path === "/api/v1/forgejo-connections" && !options)
    ) {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/github-connections/manifest") {
      return { json: async () => continuation, ok: true, status: 200 };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("form")
    .find((form) => form.text().includes("Connect GitHub App"))
    .trigger("submit");
  await flushPromises();
  expect(
    wrapper.get('form[action*="github.com/settings/apps/new"]').exists(),
  ).toBe(true);
  wrapper.unmount();
});

it("accepts complete GitHub Repository selection evidence", async () => {
  const requestId = "00000000-0000-4000-8000-000000000001";
  const repository = {
    api_url: "https://api.github.com/repos/operator/repository",
    assignment_count: 0,
    credential_type: "forge_connection",
    deletion_eligible: true,
    forge_connection_id: "github-connection",
    forge_repository_id: 11,
    health: "healthy",
    health_error: null,
    id: "repository-1",
    lifecycle: "enabled",
    name: "operator/repository",
    provider: "github",
    url: "https://github.com/operator/repository.git",
    verification_id: requestId,
    verified_at: 1_000,
    web_url: "https://github.com/operator/repository",
  };
  expect(validGitHubSelection([repository], [11], requestId)).toBe(true);
  expect(validGitHubSelection([], [11], requestId)).toBe(false);
  expect(
    reconciledGitHubSelection(
      {
        verification_history: [
          {
            affected_repository_ids: [11],
            id: requestId,
            outcome: "success",
            trigger: "repository_selection",
          },
        ],
      },
      [repository],
      [11],
      requestId,
    ),
  ).toBe(true);

  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  vi.mocked(fetch).mockResolvedValueOnce({
    json: async () => [repository],
    ok: true,
    status: 201,
  });
  await expect(registerGitHubSelection("qb_csrf", [11])).resolves.toEqual({
    registered: true,
  });
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/github-connections/repositories" && options) {
      throw new TypeError("ambiguous network failure");
    }
    throw new Error(`unexpected request ${path}`);
  });
  await expect(registerGitHubSelection("qb_csrf", [11])).resolves.toEqual({
    ambiguous: true,
    message: "GitHub Repository selection request failed",
    requestId,
  });
});

it("emits malformed successful provider responses as errors", async () => {
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (
      path === "/api/v1/github-connections" ||
      (path === "/api/v1/forgejo-connections" && !options)
    ) {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections/discover") {
      return {
        json: async () => {
          throw new SyntaxError("invalid JSON");
        },
        ok: true,
        status: 200,
      };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .get("#forgejo-connection-base-url")
    .setValue("https://forgejo.example");
  await wrapper.get("#forgejo-connection-token").setValue("token");
  await wrapper.get("#forgejo-connection-form").trigger("submit");
  await flushPromises();
  expect(wrapper.emitted("error").at(-1)).toEqual(["invalid JSON"]);
  wrapper.unmount();
});

it("hides absent-state actions when provider authority is unknown", async () => {
  vi.mocked(fetch).mockImplementation(async (path) => {
    if (path === "/api/v1/github-connections") {
      throw new Error("GitHub unavailable");
    }
    if (path === "/api/v1/forgejo-connections") {
      return { json: async () => null, ok: true, status: 200 };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.text()).not.toContain("Connect GitHub App");
  expect(wrapper.text()).toContain("Verify Forgejo Connection");
  expect(wrapper.emitted("error").at(-1)).toEqual(["GitHub unavailable"]);
  wrapper.unmount();
});

it("combines Forgejo reactivation and authority failures", async () => {
  let forgejoLoads = 0;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/github-connections") {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections" && !options) {
      forgejoLoads += 1;
      if (forgejoLoads > 1) {
        throw new Error("authority failed");
      }
      return {
        json: async () => ({ ...connection, lifecycle: "retired" }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/forgejo-connections/reactivate") {
      throw new TypeError("response lost");
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper.get("#forgejo-reactivation-token").setValue("token");
  await wrapper
    .findAll("form")
    .find((form) => form.text().includes("Reactivate Forgejo"))
    .trigger("submit");
  await flushPromises();
  expect(wrapper.text()).not.toContain("Identityoperator (7)");
  expect(wrapper.text()).not.toContain("Reactivate Forgejo Connection");
  expect(wrapper.emitted("error").at(-1)).toEqual([
    "response lost; authority failed",
  ]);
  wrapper.unmount();
});

it("rejects a null successful Forgejo registration", async () => {
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (
      path === "/api/v1/github-connections" ||
      (path === "/api/v1/forgejo-connections" && !options)
    ) {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections/discover") {
      return {
        json: async () => [{ full_name: "operator/repository", id: 11 }],
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/forgejo-connections") {
      return { json: async () => null, ok: true, status: 201 };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .get("#forgejo-connection-base-url")
    .setValue("https://forgejo.example");
  await wrapper.get("#forgejo-connection-token").setValue("token");
  await wrapper.get("#forgejo-connection-form").trigger("submit");
  await flushPromises();
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await wrapper
    .findAll("form")
    .find((form) => form.text().includes("Register selected Forgejo"))
    .trigger("submit");
  await flushPromises();
  expect(wrapper.emitted("error").at(-1)).toEqual([
    "Forgejo Connection response is invalid",
  ]);
  wrapper.unmount();
});

it("refreshes a committed Forgejo retirement without hiding a lost response", async () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  let forgejoLoads = 0;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/github-connections") {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections" && !options) {
      forgejoLoads += 1;
      return {
        json: async () => ({
          ...connection,
          lifecycle: forgejoLoads === 1 ? "enabled" : "retired",
        }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/forgejo-connections/lifecycle") {
      throw new TypeError("response lost");
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.text()).toContain("Retire Forgejo Connection");
  expect(wrapper.text()).not.toContain("Delete Forgejo Connection");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Retire Forgejo Connection")
    .trigger("click");
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("Lifecycleretired");
  expect(wrapper.text()).not.toContain("Forgejo Connection retired");
  expect(wrapper.emitted("error").at(-1)).toEqual(["response lost"]);
  wrapper.unmount();
});

it("hides stale Forgejo state when lifecycle reconciliation fails", async () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  let forgejoLoads = 0;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/github-connections") {
      return { json: async () => null, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections" && !options) {
      forgejoLoads += 1;
      if (forgejoLoads > 1) {
        throw new Error("refresh failed");
      }
      return { json: async () => connection, ok: true, status: 200 };
    }
    if (path === "/api/v1/forgejo-connections/lifecycle") {
      throw new TypeError("response lost");
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ProviderConnections, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Retire Forgejo Connection")
    .trigger("click");
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).not.toContain("Identityoperator (7)");
  expect(wrapper.emitted("error").at(-1)).toEqual([
    "response lost; refresh failed",
  ]);
  wrapper.unmount();
});
