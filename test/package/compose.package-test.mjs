import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";

const applicationVersion = readFileSync(".env", "utf8").match(
  /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/m,
)?.[1];
assert.ok(applicationVersion, ".env must define a semantic QUALITY_BAR_VERSION");
const serviceName = "quality-bar";
const projectName = `quality-bar-package-${process.pid}`;

function run(command, arguments_, environment = {}) {
  return execFileSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
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

test("Compose boots one Linux amd64 service as one unprivileged application process", async () => {
  const hostPort = await reservePort();
  const environment = {
    COMPOSE_PROJECT_NAME: projectName,
    QUALITY_BAR_HTTP_PORT: String(hostPort),
    QUALITY_BAR_VERSION: applicationVersion,
  };

  const configuration = JSON.parse(
    run("docker", ["compose", "config", "--format", "json"], environment),
  );
  assert.deepEqual(Object.keys(configuration.services), [serviceName]);
  assert.equal(configuration.services[serviceName].platform, "linux/amd64");
  assert.equal(
    configuration.services[serviceName].image,
    `quality-bar:${applicationVersion}`,
  );
  assert.equal(configuration.services[serviceName].profiles, undefined);
  assert.equal(configuration.services[serviceName].depends_on, undefined);

  let primaryFailure;
  try {
    run("docker", ["compose", "build"], environment);
    run("docker", ["compose", "up", "--detach", "--wait"], environment);

    assert.equal(
      run("docker", [
        "image",
        "inspect",
        `quality-bar:${applicationVersion}`,
        "--format",
        "{{.Os}}/{{.Architecture}}",
      ]),
      "linux/amd64",
    );
    assert.equal(
      run(
        "docker",
        ["compose", "exec", "-T", serviceName, "id", "-u"],
        environment,
      ),
      "10001",
    );
    const processArguments = run(
      "docker",
      ["compose", "exec", "-T", serviceName, "cat", "/proc/1/cmdline"],
      environment,
    )
      .split("\u0000")
      .filter(Boolean);
    assert.equal(processArguments[0], "node");
    assert.equal(processArguments.at(-1), "src/main.js");

    const response = await fetch(`http://127.0.0.1:${hostPort}/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "live" });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      run(
        "docker",
        ["compose", "down", "--volumes", "--remove-orphans"],
        environment,
      );
    } catch (cleanupError) {
      if (!primaryFailure) {
        throw cleanupError;
      }
      process.stderr.write(`Package cleanup also failed: ${cleanupError.message}\n`);
    }
  }
});
