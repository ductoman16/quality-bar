import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import SystemView from "./SystemView.vue";
import { validConfiguration, validSystem } from "./contract.js";

const configuration = {
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  service_tier: "standard",
};
const timestamp = "2026-08-20T12:00:00.000Z";
const keyIdentity = `sha256:${"a".repeat(64)}`;
const system = {
  application: {
    application_version: "1.2.3",
    error: null,
    installation_key_identity: keyIdentity,
    schema_version: 1,
    status: "available",
  },
  backup: {
    error: null,
    last_successful: {
      application_version: "1.2.3",
      created_at: timestamp,
      installation_key_identity: keyIdentity,
      kind: "daily",
      schema_version: 1,
    },
    status: "current",
  },
  bootstrap: { status: "complete" },
  browser_sessions: { active_count: 1, status: "available" },
  codex: {
    catalog: {
      codex_cli_version: "0.145.0",
      models: ["sol", "terra", "luna"].map((name) => ({
        id: `gpt-5.6-${name}`,
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        service_tiers: ["standard", "fast"],
      })),
    },
    status: "available",
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
  durable_core: {
    database_version: "3.50.0",
    foreign_keys: true,
    integrity: "ok",
    journal_mode: "wal",
    schema_version: 1,
    status: "ready",
    synchronous: "full",
  },
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
  storage: {
    cleanup: {
      artifacts_removed: 0,
      error: null,
      last_run_at: timestamp,
      sessions_removed: 0,
      status: "available",
    },
    filesystems: [
      {
        available_bytes: 1_000,
        filesystem: "state",
        path: "/state",
        status: "available",
      },
      {
        available_bytes: 2_000,
        filesystem: "checkouts",
        path: "/checkouts",
        status: "available",
      },
    ],
    reserve_bytes: 100,
    status: "available",
  },
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
        return { json: async () => system, ok: true, status: 200 };
      }
      if (path === "/api/v1/waiver-adjudicator-configuration") {
        if (options) {
          return {
            json: async () => ({ changed: true, configuration }),
            ok: true,
            status: 200,
          };
        }
        return {
          json: async () => ({ configured: true, configuration }),
          ok: true,
          status: 200,
        };
      }
      throw new Error(`unexpected request ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("renders complete polling and delivery facts and saves configuration", async () => {
  expect(validSystem(system)).toBe(true);
  expect(
    validConfiguration(
      { configured: false, configuration },
      system.codex.catalog.models,
    ),
  ).toBe(false);
  expect(
    validSystem({ ...system, durable_core: { status: "probably-ready" } }),
  ).toBe(false);
  expect(
    validSystem({
      ...system,
      execution_providers: [
        {
          error: { code: "invalid", message: "Invalid", recovery: "Retry" },
          id: "codex",
          name: "Codex",
          status: "available",
        },
      ],
    }),
  ).toBe(false);
  expect(
    validSystem({
      ...system,
      codex_execution: {
        ...system.codex_execution,
        failures: [
          {
            completed_at: timestamp,
            error: null,
            evaluation_id: "evaluation-1",
            review_run_id: "run-1",
          },
        ],
      },
    }),
  ).toBe(false);
  expect(
    validSystem({
      ...system,
      polling: { ...system.polling, extra: true },
    }),
  ).toBe(false);
  expect(
    validSystem({
      ...system,
      delivery: { ...system.delivery, extra: true },
    }),
  ).toBe(false);
  const wrapper = mount(SystemView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.findAll("h2")[0].text()).toBe("Codex execution");
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

it("focuses the invalid configuration field", async () => {
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === "/api/v1/system") {
      return { json: async () => system, ok: true, status: 200 };
    }
    if (!options) {
      return {
        json: async () => ({ configured: true, configuration }),
        ok: true,
        status: 200,
      };
    }
    return {
      json: async () => ({
        error: {
          code: "codex_service_tier_unsupported",
          message: "Service tier is unsupported",
          request_id: "request-1",
        },
      }),
      ok: false,
      status: 422,
    };
  });
  const wrapper = mount(SystemView, {
    attachTo: document.body,
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("output").text()).toBe("Service tier is unsupported");
  expect(document.activeElement).toBe(wrapper.get("#waiver-tier").element);
  wrapper.unmount();
});
