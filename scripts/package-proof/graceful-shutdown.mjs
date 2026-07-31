import assert from "node:assert/strict";

/**
 * @param {{
 *   configuration: import("./compose-configuration.mjs").ComposeConfiguration,
 *   fixture: import("./package-fixture.mjs").PackageFixture,
 *   serviceName: string,
 * }} input
 */
export function proveGracefulShutdown({ configuration, fixture, serviceName }) {
  fixture.runCompose(["stop", serviceName]);
  const logs = fixture.runCompose(["logs", "--no-color", serviceName]);
  const facts = {
    completed: logs.includes('"event":"application_shutdown_completed"'),
    started: logs.includes('"event":"application_shutdown_started"'),
    stopGracePeriod: configuration.services[serviceName].stop_grace_period,
  };
  assert.deepEqual(facts, {
    completed: true,
    started: true,
    stopGracePeriod: "15m5s",
  });
  return facts;
}
