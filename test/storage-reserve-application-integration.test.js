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
        assertWorkAdmissionAvailable() {
          throw Object.assign(failure, { action: "work_admission" });
        },
        readFacts: () => lowFacts,
      }),
  });
  assert.throws(
    () => application.assertWorkAdmissionAvailable(),
    (error) =>
      error instanceof StorageReserveError &&
      /** @type {any} */ (error).action === "work_admission",
  );
  assert.throws(
    () => application.assertCodexStartAvailable(),
    (error) =>
      error instanceof StorageReserveError &&
      /** @type {any} */ (error).action === "codex_start",
  );

  const system = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(system.status, 200);
  assert.deepEqual(/** @type {any} */ (await system.json()).storage, lowFacts);
});
