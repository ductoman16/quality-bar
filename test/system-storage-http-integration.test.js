import assert from "node:assert/strict";
import test from "node:test";

import { installationKeyIdentity } from "../src/sqlite-backup.js";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";

test("the authenticated System API exposes storage identity, cleanup, backup, and migration facts", async () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");
  const { request } = await startApplication({ now: () => now });
  const response = await request("/api/v1/system", {
    headers: await authenticatedOperatorHeaders(request),
  });
  assert.equal(response.status, 200);
  const system = /** @type {any} */ (await response.json());
  assert.deepEqual(system.application, {
    application_version: "1.2.3",
    error: null,
    installation_key_identity: installationKeyIdentity(Buffer.alloc(32, 7)),
    schema_version: 53,
    status: "available",
  });
  assert.deepEqual(system.backup, {
    error: null,
    last_successful: null,
    status: "empty",
  });
  assert.deepEqual(system.migration, {
    error: null,
    from_schema_version: 53,
    pre_migration_snapshot: null,
    pre_migration_snapshot_status: "not_applicable",
    status: "not_required",
    to_schema_version: 53,
  });
  assert.deepEqual(system.durable_core, {
    database_version: system.durable_core.database_version,
    foreign_keys: true,
    integrity: "ok",
    journal_mode: "wal",
    schema_version: 53,
    schema_version_before_migration: 0,
    status: "ready",
    synchronous: "full",
  });
  assert.deepEqual(system.storage.cleanup, {
    artifacts_removed: 0,
    error: null,
    last_run_at: "2026-08-02T12:00:00.000Z",
    sessions_removed: 0,
    status: "available",
  });
});
