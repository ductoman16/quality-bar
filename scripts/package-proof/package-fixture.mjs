import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command, arguments_, environment = {}, input) {
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
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
  const serviceName = "quality-bar";
  const environment = {
    COMPOSE_PROJECT_NAME: `quality-bar-package-${process.pid}`,
    QUALITY_BAR_CONFIG_FILE: configurationPath,
    QUALITY_BAR_HTTP_PORT: String(await reservePort()),
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
    masterKey,
    serviceName,
    runCompose(arguments_, input) {
      return run("docker", ["compose", ...arguments_], environment, input);
    },
    runDocker(arguments_) {
      return run("docker", arguments_, environment);
    },
    cleanup(primaryFailure) {
      try {
        this.runCompose(["down", "--volumes", "--remove-orphans"]);
      } catch (cleanupError) {
        if (!primaryFailure) {
          throw cleanupError;
        }
        process.stderr.write(
          `Package cleanup also failed: ${cleanupError.message}\n`,
        );
      }
      rmSync(fixtureDirectory, { force: true, recursive: true });
    },
  };
}
