import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import SystemView from "./SystemView.vue";

const configuration = {
  model: "gpt-test",
  reasoning_effort: "high",
  service_tier: "standard",
};
const timestamp = "2026-08-20T12:00:00.000Z";
const system = {
  backup: { status: "current" },
  bootstrap: { status: "complete" },
  browser_sessions: { active_count: 1 },
  cleanup: { status: "available" },
  codex: {
    catalog: {
      models: [
        {
          id: "gpt-test",
          reasoning_efforts: ["high"],
          service_tiers: ["standard"],
        },
      ],
    },
  },
  codex_execution: {
    concurrency: {
      maximum_running: 2,
      running_count: 0,
      start_gate: "available",
    },
    failures: [],
    queue: { count: 0, rows: [] },
    running: { count: 0, rows: [] },
  },
  delivery: {
    surfaces: [
      {
        adjudication_id: null,
        attempt_count: 1,
        connection_id: "connection-1",
        decision_id: null,
        definitive: true,
        error: null,
        evaluation_id: "evaluation-1",
        external_id: 42,
        finding_id: null,
        last_attempt_at: timestamp,
        next_attempt_at: null,
        owner_kind: "evaluation",
        provider: "github",
        provider_gate_error: null,
        provider_gate_until: null,
        publication_status: "succeeded",
        published_at: timestamp,
        reconciliation_required: false,
        repository_id: "repository-1",
        source_identity: "evaluation-1:commit-status",
        status: "succeeded",
        surface: "commit_status",
        target: "abc123",
      },
    ],
  },
  durable_core: { status: "ready" },
  execution_providers: [{ id: "codex", name: "Codex", status: "available" }],
  implementer_token: { status: "active" },
  polling: {
    connections: [
      {
        connection_id: "connection-1",
        error: null,
        external_identity: {
          app_id: 7,
          app_slug: "quality-bar",
          installation_id: 9,
          principal_id: 11,
          principal_login: "operator",
        },
        health: "healthy",
        health_error: null,
        lifecycle: "enabled",
        next_attempt_after_correction: false,
        next_attempt_at: null,
        provider: "github",
        rate_gate_until: null,
        repositories: [
          {
            baseline_status: "complete",
            error: null,
            forge_repository_id: 13,
            health: "healthy",
            health_error: null,
            last_success_at: timestamp,
            lifecycle: "enabled",
            name: "operator/repository",
            next_attempt_after_correction: false,
            next_attempt_at: timestamp,
            rate_gate_until: null,
            repository_id: "repository-1",
          },
        ],
      },
    ],
  },
  storage: { status: "available" },
  storage_reserve: { status: "available" },
};

beforeEach(() => {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "qb_csrf=csrf-token",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (path === "/api/v1/system") {
        return { json: async () => system, ok: true };
      }
      if (path === "/api/v1/waiver-adjudicator-configuration") {
        if (options) {
          return {
            json: async () => ({ changed: true, configuration }),
            ok: true,
          };
        }
        return {
          json: async () => ({ configured: true, configuration }),
          ok: true,
        };
      }
      throw new Error(`unexpected request ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("renders complete polling and delivery facts and saves configuration", async () => {
  const wrapper = mount(SystemView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.text()).toContain(
    "App quality-bar (external 7), installation 9",
  );
  expect(wrapper.text()).toContain("Last success 2026-08-20T12:00:00.000Z");
  expect(wrapper.text()).toContain("External identity 42");
  expect(wrapper.text()).toContain("Source evaluation-1:commit-status");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/waiver-adjudicator-configuration",
    {
      body: JSON.stringify(configuration),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "PATCH",
    },
  );
  expect(wrapper.text()).toContain("Saved");
  wrapper.unmount();
});
