import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";

const repository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  outcome: "success",
  permissions: { admin: true, pull: true, push: true },
  private: true,
};

test("SQLite preserves completed Forgejo evidence when replacement identity mismatches", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-identity-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    verifier: {
      async verify({ token }) {
        return {
          capabilities: { private_git_read: "verified" },
          principal: {
            id: token === "wrong-principal-pat" ? 8 : 7,
            login: "operator",
          },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });

  timestamp = 2_000;
  await assert.rejects(() => service.rotate({ token: "wrong-principal-pat" }), {
    code: "forgejo_rotation_identity_mismatch",
  });
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_rotation_identity_mismatch",
    message: "Replacement Forgejo PAT does not match the configured Connection",
  });
  assert.deepEqual(
    core.get(
      `SELECT profile, reported_version, principal, scopes, capabilities,
              repositories, error_code, error_message
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    {
      capabilities: JSON.stringify({ private_git_read: "verified" }),
      error_code: "forgejo_rotation_identity_mismatch",
      error_message:
        "Replacement Forgejo PAT does not match the configured Connection",
      principal: JSON.stringify({ id: 8, login: "operator" }),
      profile: "forgejo-v16",
      reported_version: "16.0.4",
      repositories: JSON.stringify([repository]),
      scopes: JSON.stringify([
        "read:repository",
        "write:issue",
        "write:repository",
      ]),
    },
  );
  service.destroy();
  core.close();
});

test("SQLite rejects a stale failed rotation after another replacement succeeds", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-concurrent-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  let releaseFailure = () => {};
  let markFailureStarted = () => {};
  const failureStarted = new Promise((resolve) => {
    markFailureStarted = () => resolve(undefined);
  });
  const failureReleased = new Promise((resolve) => {
    releaseFailure = () => resolve(undefined);
  });
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
        "verification-3",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 8),
    now: () => timestamp,
    verifier: {
      async verify({ token }) {
        if (token === "stale-failing-pat") {
          markFailureStarted();
          await failureReleased;
          throw Object.assign(new Error("Forgejo provider unavailable"), {
            code: "forgejo_provider_unavailable",
          });
        }
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });

  const stale = service.rotate({ token: "stale-failing-pat" });
  await failureStarted;
  timestamp = 2_000;
  const current =
    /** @type {NonNullable<Awaited<ReturnType<typeof service.read>>>} */ (
      await service.rotate({ token: "current-replacement-pat" })
    );
  releaseFailure();
  await assert.rejects(stale, {
    code: "forgejo_connection_rotation_conflict",
  });
  assert.equal(current?.health, "healthy");
  assert.deepEqual(service.read()?.health_error, null);
  assert.deepEqual(
    core.all(
      "SELECT id, error_code FROM forgejo_connection_verifications ORDER BY rowid",
    ),
    [
      { error_code: null, id: "verification-1" },
      { error_code: null, id: "verification-3" },
    ],
  );
  service.destroy();
  core.close();
});

test("SQLite rotates after verifying an empty set of active Forgejo Repositories", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-disabled-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  /** @type {any[]} */
  const verificationInputs = [];
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 9),
    now: () => 1_000,
    verifier: {
      async verify(input) {
        verificationInputs.push(input);
        return {
          capabilities:
            input.repositoryIds?.length === 0
              ? {
                  enumeration: "verified",
                  private_git_read: "not_completed",
                }
              : { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: input.repositoryIds?.length === 0 ? [] : [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled' WHERE id = 'repository-1'",
  );

  const rotated =
    /** @type {NonNullable<Awaited<ReturnType<typeof service.read>>>} */ (
      await service.rotate({ token: "replacement-pat" })
    );

  assert.equal(rotated?.health, "healthy");
  assert.deepEqual(verificationInputs[1]?.repositoryIds, []);
  assert.deepEqual(
    core.get(
      `SELECT trigger, capabilities, repositories, error_code
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    {
      capabilities: JSON.stringify({
        enumeration: "verified",
        private_git_read: "not_completed",
      }),
      error_code: null,
      repositories: "[]",
      trigger: "rotation",
    },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "disabled",
  );
  service.destroy();
  core.close();
});
