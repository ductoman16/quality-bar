import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PackageFixture = {
  applicationVersion: string;
  environment: Record<string, string>;
  fixtureDirectory: string;
  imageRepository: string;
  masterKey: string;
  serviceName: string;
  runCompose: (arguments_: string[], input?: string) => string;
  runDocker: (arguments_: string[]) => string;
  cleanup: (primaryFailure?: unknown) => void;
};

function run(
  command: string,
  arguments_: string[],
  environment: Record<string, string> = {},
  input?: string,
) {
  return execFileSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...environment },
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function reservePort() {
  const server = createServer();
  await new Promise(
    (resolve: (value: void) => void, reject: (reason?: unknown) => void) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(undefined));
    },
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("package_fixture_port_reservation_failed");
  }
  const { port } = address;
  await new Promise(
    (resolve: (value: void) => void, reject: (reason?: unknown) => void) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    },
  );
  return port;
}

export async function createPackageFixture() {
  const applicationVersion = readFileSync(".env", "utf8").match(
    /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/m,
  )?.[1];
  if (!applicationVersion) {
    throw new Error(".env must define a semantic QUALITY_BAR_VERSION");
  }
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "quality-bar-package-"));
  const configurationPath = join(fixtureDirectory, "config.env");
  const masterKeyPath = join(fixtureDirectory, "quality-bar-master-key");
  const masterKey = Buffer.alloc(32, 7).toString("base64");
  const imageRepository = `quality-bar-package-${process.pid}`;
  const serviceName = "quality-bar";
  const environment = {
    COMPOSE_PROJECT_NAME: `quality-bar-package-${process.pid}`,
    QUALITY_BAR_CONFIG_FILE: configurationPath,
    QUALITY_BAR_HTTP_PORT: String(await reservePort()),
    QUALITY_BAR_IMAGE_REPOSITORY: imageRepository,
    QUALITY_BAR_MASTER_KEY_FILE: masterKeyPath,
    QUALITY_BAR_VERSION: applicationVersion,
  };

  writeFileSync(
    configurationPath,
    [
      "QUALITY_BAR_EXTERNAL_ORIGIN=https://quality-bar.example",
      "QUALITY_BAR_TRUSTED_PROXY_ADDRESSES=127.0.0.1",
    ].join("\n"),
  );
  writeFileSync(masterKeyPath, masterKey);

  return {
    applicationVersion,
    environment,
    fixtureDirectory,
    imageRepository,
    masterKey,
    serviceName,
    runCompose(arguments_: string[], input?: string) {
      return run("docker", ["compose", ...arguments_], environment, input);
    },
    runDocker(arguments_: string[]) {
      return run("docker", arguments_, environment);
    },
    cleanup(primaryFailure?: unknown) {
      try {
        this.runCompose(["down", "--volumes", "--remove-orphans"]);
      } catch (cleanupError) {
        if (!primaryFailure) {
          throw cleanupError;
        }
        const detail =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        process.stderr.write(`Package cleanup also failed: ${detail}\n`);
      }
      rmSync(fixtureDirectory, { force: true, recursive: true });
    },
  };
}
