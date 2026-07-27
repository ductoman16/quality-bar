import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService, RepositoryError } from "../src/repository.js";

test("a verified normalized Repository identity is inserted once and failed verification stores nothing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run("DROP TABLE repositories");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '8' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 8");
  prior.close();

  const core = openDurableCore(databasePath);
  assert.equal(core.facts.schemaVersion, 10);
  /** @type {string[]} */
  const verifiedUrls = [];
  const repositories = createRepositoryService(core, {
    createId: () => "repository-1",
    masterKey: Buffer.alloc(32, 7),
    now: () => 47,
    async verifyRead(url) {
      verifiedUrls.push(url);
      if (url.includes("unreachable")) {
        return Promise.reject(
          new RepositoryError(
            "repository_git_read_failed",
            "Repository Git read verification failed",
          ),
        );
      }
    },
  });

  await assert.rejects(
    () =>
      repositories.register({
        url: "https://example.com/unreachable.git",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    0,
  );

  const created = await repositories.register({
    url: "https://EXAMPLE.com:443/%7Eteam/repository.git/",
  });
  assert.deepEqual(created, {
    id: "repository-1",
    url: "https://example.com/~team/repository.git",
  });
  assert.deepEqual(verifiedUrls, [
    "https://example.com/unreachable.git",
    "https://example.com/~team/repository.git",
  ]);
  assert.deepEqual(
    core.all(
      "SELECT id, normalized_url, created_at, verified_at FROM repositories",
    ),
    [
      {
        created_at: 47,
        id: "repository-1",
        normalized_url: "https://example.com/~team/repository.git",
        verified_at: 47,
      },
    ],
  );

  await assert.rejects(
    () =>
      repositories.register({
        url: "https://example.com/~team/repository.git",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_identity_conflict",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    1,
  );
  core.close();
  rmSync(directory, { force: true, recursive: true });
});

test("credentialed registration atomically stores only a Repository-bound encrypted credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run("DROP TABLE repository_credentials");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '9' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 9");
  prior.close();

  const core = openDurableCore(databasePath);
  assert.equal(core.facts.schemaVersion, 10);
  /** @type {object[]} */
  const verificationCredentials = [];
  const repositories = createRepositoryService(core, {
    createId: () => "repository-private",
    masterKey: Buffer.alloc(32, 7),
    now: () => 48,
    async verifyRead(url, credential) {
      verificationCredentials.push({ credential, url });
      if (url.includes("unreachable")) {
        return Promise.reject(
          new RepositoryError(
            "repository_git_read_failed",
            "Repository Git read verification failed",
          ),
        );
      }
    },
  });

  await assert.rejects(
    () =>
      repositories.register({
        token: "private-token-value",
        url: "https://example.com/unreachable.git",
        username: "operator",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repository_credentials")?.count,
    0,
  );

  const created = await repositories.register({
    token: "private-token-value",
    url: "https://example.com/private.git",
    username: "operator",
  });
  assert.deepEqual(created, {
    id: "repository-private",
    url: "https://example.com/private.git",
  });
  assert.deepEqual(verificationCredentials, [
    {
      credential: {
        token: "private-token-value",
        username: "operator",
      },
      url: "https://example.com/unreachable.git",
    },
    {
      credential: {
        token: "private-token-value",
        username: "operator",
      },
      url: "https://example.com/private.git",
    },
  ]);
  const stored = /** @type {{encrypted_credential: string}} */ (
    core.get(
      "SELECT encrypted_credential FROM repository_credentials WHERE repository_id = ?",
      "repository-private",
    )
  );
  assert.match(stored.encrypted_credential, /^v1\./);
  assert.doesNotMatch(
    stored.encrypted_credential,
    /operator|private-token-value/,
  );
  assert.deepEqual(
    core
      .all("PRAGMA table_info(repository_credentials)")
      .flatMap((column) =>
        column ? [{ name: column.name, type: column.type }] : [],
      ),
    [
      { name: "repository_id", type: "TEXT" },
      { name: "encrypted_credential", type: "TEXT" },
      { name: "created_at", type: "INTEGER" },
    ],
  );
  repositories.destroy();
  core.close();

  const reopened = openDurableCore(databasePath);
  assert.throws(
    () =>
      createRepositoryService(reopened, {
        masterKey: Buffer.alloc(32, 8),
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_credential_undecryptable",
  );
  reopened.close();
  rmSync(directory, { force: true, recursive: true });
});
