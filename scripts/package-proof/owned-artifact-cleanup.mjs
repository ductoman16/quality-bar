import assert from "node:assert/strict";

/** @typedef {import("./package-fixture.mjs").PackageFixture} PackageFixture */

/** @param {{fixture: PackageFixture, serviceName: string}} input */
export function proveOwnedArtifactCleanup({ fixture, serviceName }) {
  const orphanedCheckout =
    "/var/cache/quality-bar/checkouts/absent-work/1/checkout";
  fixture.runCompose([
    "exec",
    "-T",
    serviceName,
    "mkdir",
    "-p",
    orphanedCheckout,
  ]);
  fixture.runCompose(["stop", serviceName]);
  fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);
  assert.equal(
    fixture.runCompose([
      "exec",
      "-T",
      serviceName,
      "test",
      "!",
      "-e",
      orphanedCheckout,
    ]),
    "",
  );
}
