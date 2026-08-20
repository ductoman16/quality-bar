import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ProviderConnections from "./ProviderConnections.vue";
import { validGitHubSelection, validManifestContinuation } from "./contract.js";
import { registerGitHubSelection } from "./github-selection.js";

const connection = {
  health: "healthy",
  health_error: null,
  id: "forgejo-connection",
  lifecycle: "enabled",
  principal: { id: 7, login: "operator" },
  verification_history: [
    {
      id: "verification-1",
      repositories: [{ full_name: "operator/repository", id: 11 }],
      trigger: "onboarding",
      verified_at: 1_000,
    },
  ],
};

beforeEach(() => {
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
