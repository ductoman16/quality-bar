import { availableStorageReserve } from "./storage-reserve-support.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";

test("SQLite creates the final Forgejo schema directly from v16", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v16-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run("DROP TABLE forgejo_repository_polls");
  prior.run("DROP TABLE forgejo_repositories");
  prior.run("DROP TABLE forgejo_connection_verifications");
  prior.run("DROP TABLE forgejo_connection_credentials");
  prior.run("DROP TABLE forgejo_connections");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '16' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 16");
  prior.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 42);
  assert.deepEqual(
    migrated.get(
      `SELECT name
       FROM pragma_table_info('forgejo_connections')
       WHERE name = 'lifecycle'`,
    ),
    { name: "lifecycle" },
  );
  migrated.close();
});

test("SQLite restore migration requires a fresh Forgejo baseline before polling", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v19-polling-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  const service = createForgejoConnectionService(current, {
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 19),
    now: () => 1_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
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
              outcome: "success",
              permissions: { admin: true, pull: true, push: true },
              private: true,
            },
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });
  service.destroy();
  current.run("DROP TABLE forgejo_repository_polls");
  current.run(
    "UPDATE quality_bar_metadata SET value = '19' WHERE key = 'schema_version'",
  );
  current.run("PRAGMA user_version = 19");
  current.close();

  const restored = openDurableCore(databasePath);
  assert.deepEqual(
    restored.get(
      `SELECT baseline_status, last_success_at, error_code,
              next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      baseline_status: "pending",
      error_code: null,
      last_success_at: null,
      next_attempt_at: 0,
      snapshot: null,
    },
  );
  restored.close();
});

test("SQLite migrates an untouched canonical v20 database to Forgejo polling", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v20-polling-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const canonicalV20 = openDurableCore(databasePath);
  canonicalV20.run("DROP TABLE forgejo_repository_polls");
  canonicalV20.run("DROP INDEX authority_attributions_keyset");
  canonicalV20.run(
    "ALTER TABLE authority_attributions RENAME TO authority_attributions_v22",
  );
  canonicalV20.run(`
    CREATE TABLE authority_attributions (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL CHECK (channel IN ('browser_session', 'implementer_token')),
      action TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'forbidden')),
      error_code TEXT,
      occurred_at INTEGER NOT NULL
    ) STRICT
  `);
  canonicalV20.run(
    "INSERT INTO authority_attributions SELECT * FROM authority_attributions_v22",
  );
  canonicalV20.run("DROP TABLE authority_attributions_v22");
  canonicalV20.run(
    "CREATE INDEX authority_attributions_keyset ON authority_attributions (occurred_at DESC, id DESC)",
  );
  canonicalV20.run(
    "UPDATE quality_bar_metadata SET value = '20' WHERE key = 'schema_version'",
  );
  canonicalV20.run("PRAGMA user_version = 20");
  canonicalV20.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 42);
  migrated.run(
    `INSERT INTO authority_attributions
      (id, channel, action, outcome, error_code, occurred_at)
     VALUES ('v20-host-attribution', 'host', 'password_recovery', 'success', NULL, 1)`,
  );
  assert.deepEqual(
    migrated.get(
      `SELECT name
         FROM sqlite_schema
        WHERE type = 'table' AND name = 'forgejo_repository_polls'`,
    ),
    { name: "forgejo_repository_polls" },
  );
  assert.deepEqual(
    migrated.get(
      `SELECT name
         FROM sqlite_schema
        WHERE type = 'table' AND name = 'waiver_adjudicator_configuration'`,
    ),
    { name: "waiver_adjudicator_configuration" },
  );
  migrated.close();
});

test("SQLite preserves non-default Forgejo ports during v18 migration", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v18-port-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));

  for (const [index, baseUrl, expected] of [
    [0, "http://FORGEJO.EXAMPLE:443/", "http://forgejo.example:443"],
    [1, "https://FORGEJO.EXAMPLE:80/", "https://forgejo.example:80"],
    [2, "http://FORGEJO.EXAMPLE:080/", "http://forgejo.example"],
    [3, "https://FORGEJO.EXAMPLE:0443/", "https://forgejo.example"],
    [4, "https://127.1:443/", "https://127.0.0.1"],
    [5, "https://[0:0::1]:443/", "https://[::1]"],
    [6, "https://%66orgejo.example:443/", "https://forgejo.example"],
    [7, "https://forgejo.example:/", "https://forgejo.example"],
    [8, "  https://forgejo.example:443/  ", "https://forgejo.example"],
    [9, "https://forgejo.example/./", "https://forgejo.example"],
  ]) {
    const databasePath = join(directory, `quality-bar-${index}.sqlite3`);
    const prior = openDurableCore(databasePath);
    prior.run("ALTER TABLE forgejo_connections DROP COLUMN lifecycle");
    prior.run(
      `INSERT INTO forgejo_connections (
         id, base_url, api_profile, reported_version, principal_id,
         principal_login, scopes, capabilities, health, created_at, verified_at
       ) VALUES (?, ?, 'forgejo-v16', '16.0.4', 7, 'operator', '[]', '{}',
         'healthy', 1000, 1000)`,
      `connection-${index}`,
      baseUrl,
    );
    prior.run(
      "UPDATE quality_bar_metadata SET value = '18' WHERE key = 'schema_version'",
    );
    prior.run("PRAGMA user_version = 18");
    prior.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(
      migrated.get("SELECT base_url FROM forgejo_connections")?.base_url,
      expected,
    );
    migrated.close();
  }
});

test("SQLite migrates v17 Forgejo verifications into immutable triggered history", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v17-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  const service = createForgejoConnectionService(current, {
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 5),
    now: () => 1_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
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
              outcome: "success",
              permissions: { admin: true, pull: true, push: true },
              private: true,
            },
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  service.destroy();
  current.close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TABLE forgejo_repositories;
    ALTER TABLE forgejo_connection_verifications
      RENAME TO forgejo_connection_verifications_v18;
    CREATE TABLE forgejo_connection_verifications (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES forgejo_connections(id),
      profile TEXT NOT NULL CHECK (profile = 'forgejo-v16'),
      reported_version TEXT NOT NULL,
      principal TEXT NOT NULL CHECK (json_valid(principal)),
      scopes TEXT NOT NULL CHECK (json_valid(scopes)),
      capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
      repositories TEXT NOT NULL CHECK (json_valid(repositories)),
      verified_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO forgejo_connection_verifications
      (id, connection_id, profile, reported_version, principal, scopes, capabilities, repositories, verified_at)
    SELECT id, connection_id, profile, reported_version, principal, scopes, capabilities, repositories, verified_at
    FROM forgejo_connection_verifications_v18;
    UPDATE forgejo_connections
    SET base_url = 'https://FORGEJO.EXAMPLE:443/';
    ALTER TABLE forgejo_connections DROP COLUMN lifecycle;
    UPDATE forgejo_connection_verifications
    SET repositories = (
      SELECT json_group_array(
        json_remove(value, '$.outcome', '$.permissions')
      )
      FROM json_each(forgejo_connection_verifications.repositories)
    );
    DROP TABLE forgejo_connection_verifications_v18;
    CREATE TABLE forgejo_repositories (
      repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
      connection_id TEXT NOT NULL REFERENCES forgejo_connections(id),
      verification_id TEXT NOT NULL REFERENCES forgejo_connection_verifications(id),
      forge_repository_id INTEGER NOT NULL CHECK (forge_repository_id > 0),
      name TEXT NOT NULL CHECK (length(name) > 0),
      api_url TEXT NOT NULL CHECK (length(api_url) > 0),
      web_url TEXT NOT NULL CHECK (length(web_url) > 0),
      UNIQUE (connection_id, forge_repository_id)
    ) STRICT;
    UPDATE quality_bar_metadata SET value = '17' WHERE key = 'schema_version';
    PRAGMA user_version = 17;
    COMMIT;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 42);
  assert.equal(
    migrated.get(
      "SELECT lifecycle FROM forgejo_connections WHERE id = 'connection-1'",
    )?.lifecycle,
    "enabled",
  );
  assert.equal(
    migrated.get(
      "SELECT base_url FROM forgejo_connections WHERE id = 'connection-1'",
    )?.base_url,
    "https://forgejo.example",
  );
  assert.deepEqual(
    migrated.get(
      `SELECT trigger, error_code, error_message
       FROM forgejo_connection_verifications
       WHERE id = 'verification-1'`,
    ),
    { error_code: null, error_message: null, trigger: "onboarding" },
  );
  assert.deepEqual(
    JSON.parse(
      /** @type {{repositories: string}} */ (
        migrated.get(
          "SELECT repositories FROM forgejo_connection_verifications WHERE id = 'verification-1'",
        )
      ).repositories,
    ).map((/** @type {any} */ repository) => ({
      outcome: repository.outcome,
      permissions: repository.permissions,
    })),
    [
      {
        outcome: "success",
        permissions: { admin: true, pull: true, push: true },
      },
    ],
  );
  assert.throws(
    () =>
      migrated.run(
        "DELETE FROM forgejo_connection_verifications WHERE id = 'verification-1'",
      ),
    /forgejo_connection_verification_immutable/,
  );
  migrated.close();
});
