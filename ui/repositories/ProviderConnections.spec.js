import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ProviderConnections from "./ProviderConnections.vue";
import { validGitHubSelection, validManifestContinuation } from "./contract.js";
import { registerGitHubSelection } from "./github-selection.js";

const connection = {
  api_profile: "forgejo-v16",
  base_url: "https://forgejo.example",
  capabilities: {},
  health: "healthy",
  health_error: null,
  id: "forgejo-connection",
  lifecycle: "enabled",
  polling: [],
  polling_failure: null,
  principal: { id: 7, login: "operator" },
  reported_version: "16.0.4",
  scopes: ["read:repository", "write:issue", "write:repository"],
  verification_history: [
    {
      api_profile: "forgejo-v16",
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

it("validates discovery and submits a Forgejo Connection mutation", async () => {
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
  expect(wrapper.text()).toContain("Polling");
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
    message: "GitHub Repository selection request failed",
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
