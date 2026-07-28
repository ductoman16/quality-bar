import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";

test("SQLite migrates v17 Forgejo verifications into immutable triggered history", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v17-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  const service = createForgejoConnectionService(current, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 5),
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
              outcome: "success",
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
    UPDATE forgejo_connection_verifications
    SET repositories = (
      SELECT json_group_array(json_remove(value, '$.outcome'))
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
  assert.equal(migrated.facts.schemaVersion, 19);
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
    ).map((/** @type {any} */ repository) => repository.outcome),
    ["success"],
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
