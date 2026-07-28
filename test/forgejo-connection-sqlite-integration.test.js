import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";

test("SQLite atomically stores the selected Forgejo v16 Repositories and a secret-free verification", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  assert.equal(core.facts.schemaVersion, 17);
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 1),
    now: () => 1_000,
    verifier: {
      async verify() {
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [
            {
              api_url: "https://forgejo.example/api/v1/repos/operator/private",
              clone_url: "https://forgejo.example/operator/private.git",
              full_name: "operator/private",
              html_url: "https://forgejo.example/operator/private",
              id: 11,
              private: true,
            },
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  const connection = await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  assert.deepEqual(connection, {
    api_profile: "forgejo-v16",
    base_url: "https://forgejo.example",
    capabilities: { private_git_read: "verified" },
    health: "healthy",
    id: "connection-1",
    principal: { id: 7, login: "operator" },
    reported_version: "16.0.4",
    scopes: ["read:repository", "write:issue", "write:repository"],
    verified_at: 1_000,
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    1,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_repositories")?.count,
    1,
  );
  const credential = /** @type {{encrypted_credential: string}} */ (
    core.get("SELECT encrypted_credential FROM forgejo_connection_credentials")
  );
  assert.match(credential.encrypted_credential, /^v1\./);
  assert.doesNotMatch(credential.encrypted_credential, /operator-created-pat/);
  assert.doesNotMatch(
    JSON.stringify(core.get("SELECT * FROM forgejo_connection_verifications")),
    /operator-created-pat/,
  );
  service.destroy();
  core.close();
});

test("SQLite admits exactly one Forgejo Connection when simultaneous verification succeeds", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let release = () => {};
  const verified = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let calls = 0;
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      let next = 0;
      return () => `race-${++next}`;
    })(),
    masterKey: Buffer.alloc(32, 2),
    verifier: {
      async verify() {
        calls += 1;
        if (calls === 2) {
          release();
        }
        await verified;
        return {
          capabilities: {},
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [
            {
              api_url: "https://forgejo.example/api/v1/repos/operator/private",
              clone_url: "https://forgejo.example/operator/private.git",
              full_name: "operator/private",
              html_url: "https://forgejo.example/operator/private",
              id: 11,
              private: true,
            },
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  const result = await Promise.allSettled([
    service.connect({
      base_url: "https://first.forgejo.example",
      repository_ids: [11],
      token: "first-pat",
    }),
    service.connect({
      base_url: "https://second.forgejo.example",
      repository_ids: [11],
      token: "second-pat",
    }),
  ]);
  assert.equal(result.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = result.find(({ status }) => status === "rejected");
  assert.equal(rejected?.status, "rejected");
  if (rejected?.status === "rejected") {
    assert.equal(rejected.reason.code, "forgejo_connection_conflict");
  }
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connections")?.count,
    1,
  );
  service.destroy();
  core.close();
});
