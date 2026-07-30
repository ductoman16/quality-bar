import assert from "node:assert/strict";
import { test } from "node:test";

import { StorageReserveError } from "../src/storage-reserve.js";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";

const lowFacts = {
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
      /** @type {any} */ ({
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
        readFacts: () => lowFacts,
      }),
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
      /** @type {any} */ (error).action === "work_admission",
  );
  assert.equal(admitted, false);
  let started = false;
  assert.throws(
    () =>
      application.startCodexProcess(() => {
        started = true;
        return /** @type {any} */ ({});
      }),
    (error) =>
      error instanceof StorageReserveError &&
      /** @type {any} */ (error).action === "codex_start",
  );
  assert.equal(started, false);

  const system = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(system.status, 200);
  assert.deepEqual(/** @type {any} */ (await system.json()).storage, lowFacts);
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
      /** @type {any} */ ({
        assertCodexStartAvailable() {},
        assertPollingObservationAdvanceAvailable() {},
        preparePollingObservationAdvance() {},
        assertWorkAdmissionAvailable() {},
        cleanupEligibleData() {},
        readFacts() {
          throw failure;
        },
      }),
  });
  const system = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(system.status, 503);
  const body = /** @type {any} */ (await system.json());
  assert.equal(body.error.code, "storage_reserve_check_failed");
  assert.equal(body.error.message, failure.message);
});
