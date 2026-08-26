import assert from "node:assert/strict";

import { jsonPackageProbe } from "./package-probes.mts";

export function proveRetention({
  fixture,
  serviceName,
}: {
  fixture: import("./package-fixture.mts").PackageFixture;
  serviceName: string;
}) {
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
