import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ReviewDetailView from "./ReviewDetailView.vue";
import { validReview } from "./contract.js";

const model = {
  id: "gpt-5.6-sol",
  reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
  service_tiers: ["standard", "fast"],
};
const catalog = {
  codex_cli_version: "0.145.0",
  models: [
    model,
    ...["terra", "luna"].map((name) => ({
      ...model,
      id: `gpt-5.6-${name}`,
    })),
  ],
};
const version = {
  applicability_rule: null,
  codex_configuration: {
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    service_tier: "standard",
  },
  criteria: [
    {
      id: "criterion-1",
      impact: "blocking",
      instruction: "Preserve boundaries",
      position: 1,
    },
  ],
  id: "version-1",
  number: 1,
};
const review = {
  active_version: version,
  archived: false,
  assignment: { scope: "installation_wide" },
  deletion_eligible: true,
  description: "Review boundaries",
  id: "review-1",
  name: "Boundaries",
  versions: [version],
};
const repository = {
  credential_type: "none",
  deletion_eligible: true,
  health: "healthy",
  health_error: null,
  id: "repository-1",
  lifecycle: "enabled",
  url: "https://example.test/repository.git",
};
let defaultArchived;

beforeEach(() => {
  defaultArchived = false;
  history.replaceState(null, "", "/?view=review-detail&review_id=review-1");
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "qb_csrf=csrf-token",
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (path === "/api/v1/system") {
        return {
          json: async () => ({ codex: { catalog } }),
          ok: true,
          status: 200,
        };
      }
      if (path === "/api/v1/repositories") {
        return {
          json: async () => ({ items: [repository], next_cursor: null }),
          ok: true,
          status: 200,
        };
      }
      if (path === "/api/v1/reviews") {
        return {
          json: async () => ({ reviews: defaultArchived ? [] : [review] }),
          ok: true,
          status: 200,
        };
      }
      if (path === "/api/v1/reviews?state=archived") {
        return {
          json: async () => ({
            reviews: defaultArchived ? [{ ...review, archived: true }] : [],
          }),
          ok: true,
          status: 200,
        };
      }
      if (options && String(path).startsWith("/api/v1/reviews/review-1/")) {
        const body = JSON.parse(options.body);
        if (String(path).endsWith("/archival")) {
          defaultArchived = body.archived;
        }
        return {
          json: async () => ({
            changed: true,
            review: String(path).endsWith("/archival")
              ? { ...review, archived: body.archived }
              : review,
          }),
          ok: true,
          status: 200,
        };
      }
      throw new Error(`unexpected request ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const formWith = (wrapper, text) => {
  const form = wrapper
    .findAll("form")
    .find((item) => item.text().includes(text));
  if (!form) {
    throw new Error(`form missing: ${text}`);
  }
  return form;
};

it("covers version, assignment, archival, and deletion controls", async () => {
  const invalid = structuredClone(review);
  invalid.active_version.codex_configuration.model = "attacker-model";
  invalid.versions[0].codex_configuration.model = "attacker-model";
  expect(validReview(invalid)).toBe(false);
  const unlinked = structuredClone(review);
  unlinked.active_version = {
    ...unlinked.active_version,
    id: "version-missing",
  };
  expect(validReview(unlinked)).toBe(false);
  const wrapper = mount(ReviewDetailView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();

  await wrapper.get("form.review-editor").trigger("submit");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith("/api/v1/reviews/review-1/versions", {
    body: expect.any(String),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": "csrf-token",
    },
    method: "POST",
  });

  await formWith(wrapper, "Save Assignment").trigger("submit");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith("/api/v1/reviews/review-1/assignment", {
    body: JSON.stringify({ scope: "installation_wide" }),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": "csrf-token",
    },
    method: "PATCH",
  });

  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Archive")
    .trigger("click");
  await flushPromises();
  expect(confirm).toHaveBeenCalledWith(
    'Archive Review "Boundaries"? It will be excluded from new Evaluations.',
  );

  const deleteButton = wrapper
    .findAll("button")
    .find((button) => button.text() === "Delete Review");
  await deleteButton.trigger("click");
  await wrapper
    .findAll("dialog button")
    .find((button) => button.text() === "Cancel")
    .trigger("click");
  expect(document.activeElement).toBe(deleteButton.element);
  await deleteButton.trigger("click");
  await wrapper.get("#review-delete-name").setValue("wrong");
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "confirm permanent deletion",
  );
  expect(document.activeElement).toBe(
    wrapper.get("#review-delete-name").element,
  );
  wrapper.unmount();
});

it("surfaces malformed mutation success and reconciles ambiguous deletion", async () => {
  let deleted = false;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/system") {
      return {
        json: async () => ({ codex: { catalog } }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/repositories") {
      return {
        json: async () => ({ items: [repository], next_cursor: null }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews") {
      return {
        json: async () => ({ reviews: deleted ? [] : [review] }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews?state=archived") {
      return {
        json: async () => ({ reviews: [] }),
        ok: true,
        status: 200,
      };
    }
    if (String(path).endsWith("/metadata")) {
      return { json: async () => ({}), ok: true, status: 200 };
    }
    if (options?.method === "DELETE") {
      deleted = true;
      throw new TypeError("network lost");
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ReviewDetailView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await formWith(wrapper, "Save metadata").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "Review response is invalid",
  );

  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Delete Review")
    .trigger("click");
  await wrapper.get("#review-delete-name").setValue(review.name);
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => path === "/api/v1/reviews"),
  ).toHaveLength(2);
  wrapper.unmount();
});

it("refreshes archival state without hiding a lost mutation response", async () => {
  let archived = false;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/system") {
      return {
        json: async () => ({ codex: { catalog } }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/repositories") {
      return {
        json: async () => ({ items: [repository], next_cursor: null }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews") {
      return {
        json: async () => ({ reviews: archived ? [] : [review] }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews?state=archived") {
      return {
        json: async () => ({
          reviews: archived ? [{ ...review, archived: true }] : [],
        }),
        ok: true,
        status: 200,
      };
    }
    if (String(path).endsWith("/archival") && options) {
      archived = true;
      throw new TypeError("response lost");
    }
    throw new Error(`unexpected request ${path}`);
  });
  const wrapper = mount(ReviewDetailView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Archive")
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("Archived");
  expect(wrapper.get('[role="alert"]').text()).toBe("response lost");
  wrapper.unmount();
});

it("surfaces deletion parsing and reconciliation failures", async () => {
  let reviewLoads = 0;
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/system") {
      return {
        json: async () => ({ codex: { catalog } }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/repositories") {
      return {
        json: async () => ({ items: [repository], next_cursor: null }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews" && !options) {
      reviewLoads += 1;
      if (reviewLoads > 1) {
        throw new Error("authority failed");
      }
      return {
        json: async () => ({ reviews: [review] }),
        ok: true,
        status: 200,
      };
    }
    if (path === "/api/v1/reviews?state=archived") {
      return { json: async () => ({ reviews: [] }), ok: true, status: 200 };
    }
    if (String(path).endsWith("/metadata")) {
      return { json: async () => ({}), ok: true, status: 200 };
    }
    if (options?.method === "DELETE") {
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
  const wrapper = mount(ReviewDetailView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Delete Review")
    .trigger("click");
  await wrapper.get("#review-delete-name").setValue(review.name);
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "invalid JSON; authority failed",
  );
  wrapper.unmount();
});
