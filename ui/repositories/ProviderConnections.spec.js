import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ProviderConnections from "./ProviderConnections.vue";
import { validManifestContinuation } from "./contract.js";

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
        return { json: async () => null, ok: true };
      }
      if (path === "/api/v1/forgejo-connections/discover") {
        return {
          json: async () => [{ full_name: "operator/repository", id: 11 }],
          ok: true,
        };
      }
      if (path === "/api/v1/forgejo-connections" && options) {
        return { json: async () => connection, ok: true };
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
