import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createWaiverAdjudicatorConfigurationService } from "../src/waiver/waiver-adjudicator-configuration.ts";

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
