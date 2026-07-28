import { join } from "node:path";

const containerProbeDirectory = "/app/fixtures/package";
const fixtureProbeDirectory = "fixtures/package";

/**
 * @param {import("./package-fixture.mjs").PackageFixture} fixture
 * @param {string} name
 * @param {string[]} [arguments_]
 * @param {string} [input]
 */
export function runPackageProbe(fixture, name, arguments_ = [], input) {
  fixture.runCompose([
    "exec",
    "-T",
    "--user",
    "0",
    fixture.serviceName,
    "install",
    "-d",
    "-o",
    "10001",
    "-g",
    "10001",
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
