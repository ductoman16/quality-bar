import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicatorConfigurationService } from "../src/waiver-adjudicator-configuration.js";

test("SQLite atomically preserves the one installation-wide Waiver Adjudicator Configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-config-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  let core = openDurableCore(databasePath);
  try {
    const service = createWaiverAdjudicatorConfigurationService(core, {
      now: () => 101,
    });
    service.update({
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    });
    const frozen = service.freezeForAdjudication();

    assert.throws(
      () =>
        service.update({
          model: "gpt-5.6-sol",
          reasoning_effort: "ultra",
          service_tier: "fast",
        }),
      (error) =>
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "codex_reasoning_effort_unsupported",
    );
    assert.deepEqual(service.freezeForAdjudication(), frozen);
    assert.throws(
      () =>
        core.run(
          `INSERT INTO waiver_adjudicator_configuration (
             singleton, model, reasoning_effort, service_tier, updated_at
           ) VALUES (2, ?, ?, ?, ?)`,
          "gpt-5.6-sol",
          "xhigh",
          "fast",
          102,
        ),
      /CHECK constraint failed/,
    );

    core.close();
    core = openDurableCore(databasePath);
    assert.deepEqual(
      createWaiverAdjudicatorConfigurationService(core).freezeForAdjudication(),
      frozen,
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite migrates schema v19 to the singleton Waiver Adjudicator Configuration", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-migration-"),
  );
  const databasePath = join(directory, "quality-bar.sqlite3");
  let core = openDurableCore(databasePath);
  try {
    core.run("DROP TABLE waiver_adjudicator_configuration");
    core.run(
      "UPDATE quality_bar_metadata SET value = '19' WHERE key = 'schema_version'",
    );
    core.run("PRAGMA user_version = 19");
    core.close();

    core = openDurableCore(databasePath);
    assert.equal(core.facts.schemaVersion, 25);
    assert.deepEqual(createWaiverAdjudicatorConfigurationService(core).read(), {
      configured: false,
    });
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
