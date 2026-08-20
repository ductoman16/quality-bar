import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import RepositoryActions from "./RepositoryActions.vue";
import { validRepository } from "./contract.js";

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
});

it("confirms lifecycle changes and exact-identity deletion with CSRF", async () => {
  const wrapper = mount(RepositoryActions, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf", repository },
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Disabled")
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
    .find((button) => button.text() === "Delete")
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

it("recognizes an authoritatively absent ambiguous Repository deletion", async () => {
  vi.mocked(fetch).mockImplementation(async (path, options) => {
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
  });
  const wrapper = mount(RepositoryActions, {
    props: { csrfCookieName: "qb_csrf", repository },
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Delete")
    .trigger("click");
  await wrapper.get("input").setValue(repository.url);
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.emitted("changed")).toEqual([[null]]);
  expect(wrapper.emitted("refresh")).toBeUndefined();
  expect(wrapper.emitted("error")).toBeUndefined();
  wrapper.unmount();
});
