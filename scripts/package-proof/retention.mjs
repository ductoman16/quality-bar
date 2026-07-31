import assert from "node:assert/strict";

import { jsonPackageProbe } from "./package-probes.mjs";

/** @param {{fixture: import("./package-fixture.mjs").PackageFixture, serviceName: string}} input */
export function proveRetention({ fixture, serviceName }) {
  assert.equal(
    jsonPackageProbe(fixture, "retention-facts.mjs", ["seed"]).status,
    "seeded",
  );
  fixture.runCompose(["stop", serviceName]);
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  assert.deepEqual(jsonPackageProbe(fixture, "retention-facts.mjs"), {
    canonical: "survived",
    oldCount: 0,
    recentCount: 1,
  });
}
