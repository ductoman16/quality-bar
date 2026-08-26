import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import RepositoryActions from "./RepositoryActions.vue";
import { validRepository } from "./contract.ts";

const repository = {
  credential_type: "none",
  deletion_eligible: true,
  health: "healthy",
  health_error: null,
  id: "repository-1",
  lifecycle: "enabled",
  url: "https://example.test/repository.git",
};

beforeEach(() => {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "qb_csrf=csrf-token",
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (path === "/api/v1/repositories" && !options) {
        return {
          json: async () => ({ items: [], next_cursor: null }),
          ok: true,
          status: 200,
        };
      }
      if (options?.method === "PATCH") {
        return {
          json: async () => ({ ...repository, lifecycle: "disabled" }),
          ok: true,
          status: 200,
        };
      }
      return { json: async () => null, ok: true, status: 200 };
    }),
  );
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

it("accepts the canonical Generic Repository body", () => {
  expect(validRepository(repository)).toBe(true);
  const forge = {
    ...repository,
    api_url: "https://api.example.test/repositories/1",
    assignment_count: 0,
    credential_type: "forge_connection",
    forge_connection_id: "connection-1",
    forge_repository_id: 1,
    name: "owner/repository",
    provider: "forgejo",
    verification_id: "verification-1",
    verified_at: 1,
    web_url: "https://example.test/owner/repository",
  };
  expect(validRepository(forge)).toBe(true);
  expect(validRepository({ ...forge, api_url: "not a URI" })).toBe(false);
  expect(validRepository({ ...forge, web_url: "not a URI" })).toBe(false);
});

it("confirms lifecycle changes and exact-identity deletion with CSRF", async () => {
  const wrapper: any = mount(RepositoryActions, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf", repository },
  });
  await wrapper
    .findAll("button")
    .find((button: any) => button.text() === "Disabled")
    .trigger("click");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/repositories/repository-1/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "disabled" }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
  );

  await wrapper
    .findAll("button")
    .find((button: any) => button.text() === "Delete")
    .trigger("click");
  await wrapper.get("input").setValue(repository.url);
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith("/api/v1/repositories/repository-1", {
    body: "{}",
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": "csrf-token",
    },
    method: "DELETE",
  });
  expect(wrapper.emitted("changed")).toHaveLength(2);
  wrapper.unmount();
});

it("preserves an ambiguous Repository deletion error after refresh", async () => {
  vi.mocked(fetch as any).mockImplementation(
    async (path: any, options: any) => {
      if (options?.method === "DELETE") {
        throw new TypeError("network lost");
      }
      if (path === "/api/v1/repositories") {
        return {
          json: async () => ({ items: [], next_cursor: null }),
          ok: true,
          status: 200,
        };
      }
      throw new Error(`unexpected request ${path}`);
    },
  );
  const wrapper: any = mount(RepositoryActions, {
    props: { csrfCookieName: "qb_csrf", repository },
  });
  await wrapper
    .findAll("button")
    .find((button: any) => button.text() === "Delete")
    .trigger("click");
  await wrapper.get("input").setValue(repository.url);
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.emitted("changed")).toBeUndefined();
  expect(wrapper.emitted("refresh")).toEqual([["Repository deletion failed"]]);
  expect(wrapper.emitted("error")).toEqual([["Repository deletion failed"]]);
  wrapper.unmount();
});
