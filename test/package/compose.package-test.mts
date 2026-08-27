import assert from "node:assert/strict";
import { test } from "node:test";

import { createPackageFixture } from "../../scripts/package-proof/package-fixture.mts";
import { jsonPackageProbe } from "../../scripts/package-proof/package-probes.mts";

const serviceFixtureImage =
  "node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd";

test("Compose image boots, serves /health/live, and answers one authenticated request", async () => {
  const fixture = await createPackageFixture();
  let primaryFailure;

  try {
    const { environment, fixtureDirectory, serviceName } = fixture;
    const port = environment.QUALITY_BAR_HTTP_PORT;

    // The shipped image runs as an unprivileged user, so the bind-mounted
    // configuration and master key must be owned and locked down before boot.
    for (const permission of [
      ["chown", "10001:10001"],
      ["chmod", "0400"],
    ]) {
      fixture.runDocker([
        "run",
        "--rm",
        "-v",
        `${fixtureDirectory}:/fixture`,
        serviceFixtureImage,
        ...permission,
        "/fixture/config.env",
        "/fixture/quality-bar-master-key",
      ]);
    }

    fixture.runCompose(["build"]);
    fixture.runCompose(["up", "--detach", "--wait"]);

    // Poll /health/live until the service reports itself ready.
    const { liveness } = jsonPackageProbe(fixture, "http-facts.mjs", [port]);
    assert.deepEqual(liveness, { body: { status: "live" }, status: 200 });

    // Bootstrap an operator password so one authenticated request can run.
    const bootstrapPassword = "a package supplied operator password";
    fixture.runCompose(["stop", serviceName]);
    assert.equal(
      fixture.runCompose(
        [
          "run",
          "--rm",
          "--no-deps",
          "-T",
          serviceName,
          "node",
          "src/bootstrap-operator-password.ts",
        ],
        `${bootstrapPassword}\n`,
      ),
      '{"status":"operator_password_bootstrapped"}',
    );
    fixture.runCompose(["up", "--detach", "--wait", "--force-recreate"]);

    // Hit one authenticated endpoint through the real login flow.
    const authenticated = jsonPackageProbe(
      fixture,
      "authenticated-http-smoke.mjs",
      [port],
      bootstrapPassword,
    );
    assert.deepEqual(authenticated, {
      loginStatus: 204,
      systemStatus: 200,
      hasSystemCatalog: true,
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    // Shut down cleanly, tearing down containers and volumes.
    fixture.cleanup(primaryFailure);
  }
});
