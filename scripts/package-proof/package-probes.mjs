import { join } from "node:path";

const containerProbeDirectory = "/tmp/quality-bar-package-probes";
const fixtureProbeDirectory = "fixtures/package";

export function runPackageProbe(fixture, name, arguments_ = [], input) {
  fixture.runCompose([
    "exec",
    "-T",
    fixture.serviceName,
    "mkdir",
    "-p",
    containerProbeDirectory,
  ]);
  fixture.runCompose([
    "cp",
    join(fixtureProbeDirectory, name),
    `${fixture.serviceName}:${containerProbeDirectory}/${name}`,
  ]);
  return fixture.runCompose(
    [
      "exec",
      "-T",
      fixture.serviceName,
      "node",
      `${containerProbeDirectory}/${name}`,
      ...arguments_,
    ],
    input,
  );
}
