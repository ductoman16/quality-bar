import assert from "node:assert/strict";
import { test } from "node:test";

import { StorageReserveError } from "../src/storage-reserve.ts";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.ts";

const cleanupFacts = {
  artifacts_removed: 0,
  error: null,
  last_run_at: "2026-08-02T12:00:00.000Z",
  sessions_removed: 0,
  status: "available",
};

const lowFacts = {
  cleanup: cleanupFacts,
  filesystems: [
    {
      available_bytes: 6 * 1024 ** 3,
      filesystem: "state",
      path: "/var/lib/quality-bar",
      status: "available",
    },
    {
      available_bytes: 4 * 1024 ** 3,
      filesystem: "checkouts",
      path: "/var/cache/quality-bar/checkouts",
      status: "unavailable",
    },
  ],
  reserve_bytes: 5 * 1024 ** 3,
  status: "unavailable",
};

test("runtime reserve gates admission and Codex starts while System keeps exact low-space facts readable", async () => {
  const failure = new StorageReserveError(
    "storage_reserve_unavailable",
    "A required runtime filesystem is below the free-space reserve",
    { action: "work_admission", facts: lowFacts },
  );
  const { application, request } = await startApplication({
    createStorageReserve: () =>
      ({
        assertCodexStartAvailable() {
          throw Object.assign(failure, { action: "codex_start" });
        },
        assertPollingObservationAdvanceAvailable() {
          throw Object.assign(failure, {
            action: "polling_observation_advancement",
          });
        },
        preparePollingObservationAdvance() {
          throw Object.assign(failure, {
            action: "polling_observation_advancement",
          });
        },
        assertWorkAdmissionAvailable() {
          throw Object.assign(failure, { action: "work_admission" });
        },
        cleanupEligibleData() {},
        readCleanupFacts: () => cleanupFacts,
        readFacts: () => lowFacts,
      }) as any,
  });
  assert.equal("registerCodexProcess" in application, false);
  assert.equal("storageReserve" in application, false);
  let admitted = false;
  assert.throws(
    () =>
      application.admitWork(() => {
        admitted = true;
      }),
    (error) =>
      error instanceof StorageReserveError &&
      (error as any).action === "work_admission",
  );
  assert.equal(admitted, false);
  let started = false;
  assert.throws(
    () =>
      application.startCodexProcess(() => {
        started = true;
        return {} as any;
      }),
    (error) =>
      error instanceof StorageReserveError &&
      (error as any).action === "codex_start",
  );
  assert.equal(started, false);

  const system = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(system.status, 200);
  assert.deepEqual(((await system.json()) as any).storage, lowFacts);
});

test("System exposes the exact owning filesystem when reserve measurement fails", async () => {
  const failure = new StorageReserveError(
    "storage_reserve_check_failed",
    "The state filesystem free-space reserve at /var/lib/quality-bar could not be measured",
    {
      action: "system_read",
      filesystem: "state",
      path: "/var/lib/quality-bar",
    },
  );
  const { request } = await startApplication({
    createStorageReserve: () =>
      ({
        assertCodexStartAvailable() {},
        assertPollingObservationAdvanceAvailable() {},
        preparePollingObservationAdvance() {},
        assertWorkAdmissionAvailable() {},
        cleanupEligibleData() {},
        readCleanupFacts: () => cleanupFacts,
        readFacts() {
          throw failure;
        },
      }) as any,
  });
  const system = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(system.status, 503);
  const body = (await system.json()) as any;
  assert.equal(body.error.code, "storage_reserve_check_failed");
  assert.equal(body.error.message, failure.message);
});
