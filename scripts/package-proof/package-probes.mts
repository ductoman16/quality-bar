import { join } from "node:path";

const containerProbeDirectory = "/app/fixtures/package";
const fixtureProbeDirectory = "fixtures/package";

export function runPackageProbe(
  fixture: import("./package-fixture.mts").PackageFixture,
  name: string,
  arguments_: string[] = [],
  input?: string,
) {
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

export function jsonPackageProbe(
  fixture: import("./package-fixture.mts").PackageFixture,
  name: string,
  arguments_?: string[],
  input?: string,
) {
  return JSON.parse(runPackageProbe(fixture, name, arguments_, input));
}

/**
 * Run a probe in a disposable service container while the primary service is
 * stopped. The probe directory is mounted read-only so the proof uses the
 * exact source file without changing the packaged image.
 */
export function runStoppedPackageProbe(
  fixture: import("./package-fixture.mts").PackageFixture,
  name: string,
  arguments_: string[] = [],
  input?: string,
) {
  return fixture.runCompose(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-v",
      `${join(process.cwd(), fixtureProbeDirectory)}:${containerProbeDirectory}:ro`,
      fixture.serviceName,
      "node",
      `${containerProbeDirectory}/${name}`,
      ...arguments_,
    ],
    input,
  );
}

export function jsonStoppedPackageProbe(
  fixture: import("./package-fixture.mts").PackageFixture,
  name: string,
  arguments_?: string[],
  input?: string,
) {
  return JSON.parse(runStoppedPackageProbe(fixture, name, arguments_, input));
}
