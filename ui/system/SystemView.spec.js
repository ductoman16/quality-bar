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
    validSystem({
      ...system,
      execution_providers: [
        { error: {}, id: "codex", name: "Codex", status: "available" },
      ],
    }),
  ).toBe(false);
  expect(
    validSystem({
      ...system,
      codex: {
        ...system.codex,
        catalog: {
          models: system.codex.catalog.models,
          codex_cli_version: "0.145.0",
        },
      },
    }),
  ).toBe(true);
  expect(
    validSystem({
      ...system,
      storage: {
        ...system.storage,
        cleanup: {
          ...system.storage.cleanup,
          status: "unavailable",
        },
      },
    }),
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
  ).toBe(true);
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
  expect(wrapper.text()).toContain("schema 1");
  expect(wrapper.text()).toContain(keyIdentity);
  expect(wrapper.text()).toContain("None");
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

it("renders storage failures and queued execution diagnostics", async () => {
  const unavailable = structuredClone(system);
  unavailable.application.status = "unavailable";
  unavailable.application.error = {
    code: "application_unavailable",
    detail: "Application facts failed",
  };
  unavailable.storage.cleanup = {
    artifacts_removed: null,
    error: { code: "cleanup_failed", detail: "Cleanup facts failed" },
    last_run_at: null,
    sessions_removed: null,
    status: "unavailable",
  };
  unavailable.backup.status = "unavailable";
  unavailable.backup.error = {
    code: "backup_failed",
    detail: "Backup facts failed",
  };
  unavailable.codex_execution.queue = {
    count: 1,
    rows: [
      {
        evaluation_id: "evaluation-1",
        execution_status: "queued",
        gate: { code: "retry_wait" },
        lease: {
          expires_at: timestamp,
          fencing_token: 2,
          status: "held",
          worker_id: "worker-1",
        },
        next_attempt_at: timestamp,
        pre_start_attempt_count: 2,
        queue_position: 1,
        retry_cycle: 1,
        retry_error: { code: "busy", detail: "Try again" },
        retry_state: "exhausted",
        review_run_id: "run-1",
      },
    ],
  };
  vi.mocked(fetch).mockImplementation(async (path) => {
    if (path === "/api/v1/system") {
      return { json: async () => unavailable, ok: true, status: 200 };
    }
    return {
      json: async () => ({ configured: true, configuration }),
      ok: true,
      status: 200,
    };
  });
  const wrapper = mount(SystemView, {
    props: { csrfCookieName: "qb_csrf" },
  });
  await flushPromises();
  expect(wrapper.text()).toContain(
    "application_unavailable: Application facts failed",
  );
  expect(wrapper.text()).toContain("cleanup_failed: Cleanup facts failed");
  expect(wrapper.text()).toContain("none artifacts");
  expect(wrapper.text()).toContain("backup_failed: Backup facts failed");
  expect(wrapper.text()).toContain("queue 1");
  expect(wrapper.text()).toContain("busy: Try again");
  expect(wrapper.text()).toContain("fencing 2");
  wrapper.unmount();
});

it("focuses the invalid configuration field", async () => {
  let responseMode = "mapped";
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
    if (responseMode === "success") {
      return {
        json: async () => ({ changed: true, configuration }),
        ok: true,
        status: 200,
      };
    }
    return {
      json: async () => ({
        error: {
          code:
            responseMode === "mapped"
              ? "codex_service_tier_unsupported"
              : "configuration_failed",
          message:
            responseMode === "mapped"
              ? "Service tier is unsupported"
              : "Configuration unavailable",
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
  responseMode = "generic";
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "Configuration unavailable",
  );
  expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
  responseMode = "success";
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.get("output").text()).toBe("Saved");
  wrapper.unmount();
});
