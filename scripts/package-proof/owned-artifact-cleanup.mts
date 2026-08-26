import assert from "node:assert/strict";

export type PackageFixture = import("./package-fixture.mts").PackageFixture;

export function proveOwnedArtifactCleanup({
  fixture,
  serviceName,
}: {
  fixture: PackageFixture;
  serviceName: string;
}) {
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
