import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

const FORGEJO_IMAGE =
  "codeberg.org/forgejo/forgejo@sha256:3eb3107bc9de4e9d6d9e539044e6c802dc0b7be351919a145540d4cb5422bf07";

/** @param {string[]} arguments_ */
function docker(arguments_) {
  return execFileSync("docker", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Forgejo v16 service port reservation failed");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
  return address.port;
}

/** @param {string} baseUrl @param {string} route @param {string} authorization @param {unknown} [body] */
async function api(baseUrl, route, authorization, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      accept: "application/json",
      authorization,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Forgejo fixture setup failed: ${route} (${response.status}): ${detail}`,
    );
  }
  return response.json();
}

test("pinned Forgejo v16 service verifies retirement and reactivation", async () => {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const container = `quality-bar-forgejo-v16-${process.pid}`;
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-v16-"));
  /** @type {any} */
  let service;
  /** @type {any} */
  let core;
  let primaryFailure;
  /** @type {unknown[]} */
  const cleanupFailures = [];
  try {
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--publish",
      `127.0.0.1:${port}:3000`,
      "--env",
      "USER_UID=1000",
      "--env",
      "USER_GID=1000",
      "--env",
      "FORGEJO__database__DB_TYPE=sqlite3",
      "--env",
      "FORGEJO__security__INSTALL_LOCK=true",
      "--env",
      "FORGEJO__service__DISABLE_REGISTRATION=true",
      "--env",
      `FORGEJO__server__ROOT_URL=${baseUrl}/`,
      FORGEJO_IMAGE,
    ]);
    const deadline = Date.now() + 30_000;
    /** @type {Error | undefined} */
    let readinessFailure;
    while (true) {
      try {
        const response = await fetch(`${baseUrl}/api/v1/version`);
        if (response.ok) {
          break;
        }
        readinessFailure = new Error(
          `Pinned Forgejo v16 readiness returned HTTP ${response.status}: ${await response.text()}`,
        );
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        readinessFailure = error;
      }
      if (Date.now() >= deadline) {
        throw new Error("Pinned Forgejo v16 service did not become ready", {
          cause: readinessFailure,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    docker([
      "exec",
      "--user",
      "git",
      container,
      "forgejo",
      "admin",
      "user",
      "create",
      "--username",
      "operator",
      "--password",
      "QualityBarForgejo16!",
      "--email",
      "operator@example.test",
      "--admin",
      "--must-change-password=false",
    ]);
    const setupToken = docker([
      "exec",
      "--user",
      "git",
      container,
      "forgejo",
      "admin",
      "user",
      "generate-access-token",
      "--username",
      "operator",
      "--token-name",
      "quality-bar-setup",
      "--raw",
      "--scopes",
      "all",
    ]);
    const repository = /** @type {any} */ (
      await api(baseUrl, "/api/v1/user/repos", `token ${setupToken}`, {
        auto_init: true,
        name: "private",
        private: true,
      })
    );
    await api(baseUrl, "/api/v1/user/repos", `token ${setupToken}`, {
      auto_init: true,
      name: "outside-quality-bar",
      private: true,
    });
    const createToken = async (/** @type {string} */ name) => {
      const created = /** @type {any} */ (
        await api(
          baseUrl,
          "/api/v1/users/operator/tokens",
          `Basic ${Buffer.from("operator:QualityBarForgejo16!").toString("base64")}`,
          {
            name,
            repositories: [{ name: "private", owner: "operator" }],
            scopes: ["read:repository", "write:issue", "write:repository"],
          },
        )
      );
      assert.equal(typeof created.sha1, "string");
      return /** @type {string} */ (created.sha1);
    };
    const onboardingToken = await createToken("quality-bar-onboarding");
    const reactivationToken = await createToken("quality-bar-reactivation");
    const excluded = await fetch(
      `${baseUrl}/api/v1/repos/operator/outside-quality-bar`,
      {
        headers: { authorization: `token ${onboardingToken}` },
        redirect: "error",
      },
    );
    assert.equal(excluded.status, 404);
    core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    service = createForgejoConnectionService(core, {
      masterKey: Buffer.alloc(32, 7),
      verifier: createForgejoV16Verifier(),
    });
    const connected = await service.connect({
      base_url: baseUrl,
      repository_ids: [repository.id],
      token: onboardingToken,
    });
    assert.equal(connected.reported_version, "16.0.1+gitea-1.22.0");
    assert.deepEqual(connected.scopes, [
      "read:repository",
      "write:issue",
      "write:repository",
    ]);
    assert.equal(
      connected.verification_history[0].repositories[0].outcome,
      "success",
    );
    core.run("UPDATE repositories SET lifecycle = 'retired'");
    const retired = service.retire({ lifecycle: "retired" });
    assert.equal(retired.lifecycle, "retired");
    const reactivated = await service.reactivate({
      token: reactivationToken,
    });
    assert.equal(reactivated.lifecycle, "enabled");
    assert.equal(reactivated.health, "healthy");
    assert.deepEqual(
      reactivated.verification_history.map(
        (/** @type {any} */ verification) => verification.trigger,
      ),
      ["onboarding", "enablement"],
    );
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      service?.destroy();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      core?.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      docker(["rm", "--force", container]);
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  const failures = [
    ...(primaryFailure === undefined ? [] : [primaryFailure]),
    ...cleanupFailures,
  ];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Forgejo v16 service proof failed");
  }
  if (failures.length === 1) {
    throw failures[0];
  }
});
