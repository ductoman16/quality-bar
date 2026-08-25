import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createPackageFixture } from "../../scripts/package-proof/package-fixture.mjs";

const permissionFixtureImage =
  "node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd";

/** @param {string} url */
async function pollLiveness(url) {
  const deadline = Date.now() + 60_000;
  /** @type {string} */
  let lastFailure = "no attempts recorded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return /** @type {{status: string}} */ (await response.json());
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`package_smoke_liveness_timeout: ${lastFailure}`);
}

test("Compose boots, exposes liveness, serves one authenticated request, and shuts down cleanly", async () => {
  const fixture = await createPackageFixture();
  /** @type {unknown} */
  let primaryFailure;

  try {
    fixture.runDocker([
      "run",
      "--rm",
      "-v",
      `${fixture.fixtureDirectory}:/fixture`,
      permissionFixtureImage,
      "chown",
      "10001:10001",
      "/fixture/config.env",
      "/fixture/quality-bar-master-key",
    ]);
    fixture.runDocker([
      "run",
      "--rm",
      "-v",
      `${fixture.fixtureDirectory}:/fixture`,
      permissionFixtureImage,
      "chmod",
      "0400",
      "/fixture/config.env",
      "/fixture/quality-bar-master-key",
    ]);
    fixture.runCompose(["build"]);
    fixture.runCompose(["up", "--detach", "--wait"]);

    const { QUALITY_BAR_HTTP_PORT: port } = fixture.environment;
    const liveness = await pollLiveness(`http://127.0.0.1:${port}/health/live`);
    assert.deepEqual(liveness, { status: "live" });

    const operatorPassword = "a package supplied operator password";
    fixture.runCompose(["stop"]);
    const bootstrapOutput = fixture.runCompose(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        fixture.serviceName,
        "node",
        "src/bootstrap-operator-password.js",
      ],
      `${operatorPassword}\n`,
    );
    assert.equal(
      bootstrapOutput,
      '{"status":"operator_password_bootstrapped"}',
    );
    fixture.runCompose(["up", "--detach", "--wait"]);

    const proxyHeaders = {
      forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
    };
    const login = await fetch(`http://127.0.0.1:${port}/api/v1/session/login`, {
      body: JSON.stringify({ password: operatorPassword }),
      headers: { ...proxyHeaders, "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(login.status, 204);
    const setCookie = login.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("package_smoke_login_cookie_missing");
    }
    const sessionCookie = setCookie.match(
      /quality_bar_session=[A-Za-z0-9_-]{43}/,
    )?.[0];
    if (!sessionCookie) {
      throw new Error("package_smoke_session_cookie_missing");
    }

    const authenticated = await fetch(
      `http://127.0.0.1:${port}/api/v1/system`,
      { headers: { ...proxyHeaders, cookie: sessionCookie } },
    );
    assert.equal(authenticated.status, 200);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    fixture.cleanup(primaryFailure);
  }
});
