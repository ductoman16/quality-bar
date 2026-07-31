import assert from "node:assert/strict";

import { jsonStoppedPackageProbe } from "./package-probes.mjs";

/**
 * @param {import("./package-fixture.mjs").PackageFixture} fixture
 * @param {string} serviceName
 */
export function proveUpgrade(fixture, serviceName) {
  fixture.runCompose(["stop", serviceName]);
  const facts = jsonStoppedPackageProbe(fixture, "upgrade-facts.mjs", [
    fixture.applicationVersion,
    fixture.masterKey,
  ]);
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  assert.equal(facts.explicitImage, true);
  assert.equal(facts.noAutomaticUpdate, true);
  assert.deepEqual(facts.forwardMigration, {
    afterSchemaVersion: 48,
    beforeSchemaVersion: 47,
    exclusive: true,
    restoredTable: true,
  });
  assert.deepEqual(facts.rollback, {
    downgradeMigration: false,
    priorImageRequired: true,
    priorImageVersion: "0.0.9",
  });
  return facts;
}

/**
 * @param {ReturnType<typeof proveUpgrade>} upgradeFacts
 * @param {{persistedMarker: string | null, schemaVersion: number}} restoredDatabaseFacts
 */
export function withOfflineRestoreProof(upgradeFacts, restoredDatabaseFacts) {
  return {
    ...upgradeFacts,
    rollback: {
      ...upgradeFacts.rollback,
      offlineRestore:
        restoredDatabaseFacts.schemaVersion ===
          upgradeFacts.forwardMigration.afterSchemaVersion &&
        restoredDatabaseFacts.persistedMarker === "survived",
    },
  };
}
