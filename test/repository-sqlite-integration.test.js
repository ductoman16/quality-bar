import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import {
  createRepositoryService,
  RepositoryError,
} from "../src/repository/repository.js";

test("a verified normalized Repository identity is inserted once and failed verification stores nothing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  /** @type {{credential: object | undefined, options: object | undefined, url: string}[]} */
  const verifications = [];
  const repositories = createRepositoryService(core, {
    certificateAuthorityPath: "/run/secrets/private-ca.pem",
    createId: () => "repository-1",
    masterKey: Buffer.alloc(32, 7),
    now: () => 47,
    async verifyRead(url, credential, options) {
      verifications.push({ credential, options, url });
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
    credential_type: "none",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository-1",
    lifecycle: "enabled",
    url: "https://example.com/~team/repository.git",
  });
  assert.deepEqual(verifications, [
    {
      credential: undefined,
      options: { certificateAuthorityPath: "/run/secrets/private-ca.pem" },
      url: "https://example.com/unreachable.git",
    },
    {
      credential: undefined,
      options: { certificateAuthorityPath: "/run/secrets/private-ca.pem" },
      url: "https://example.com/~team/repository.git",
    },
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
  const core = openDurableCore(databasePath);
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
    credential_type: "username_token",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository-private",
    lifecycle: "enabled",
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

test("Repository lifecycle persists separately from observed health and preserves already-admitted work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  let verificationFails = false;
  const repositories = createRepositoryService(core, {
    createId: () => "repository-lifecycle",
    masterKey: Buffer.alloc(32, 7),
    now: () => 50,
    async verifyRead() {
      if (verificationFails) {
        return Promise.reject(
          new RepositoryError(
            "repository_git_read_failed",
            "Repository Git read verification failed",
          ),
        );
      }
    },
  });
  await repositories.register({ url: "https://example.com/lifecycle.git" });

  const alreadyCreatedWork = repositories.requireAcceptsNewWork(
    "repository-lifecycle",
  );
  assert.equal(alreadyCreatedWork.id, "repository-lifecycle");
  assert.deepEqual(
    await repositories.setLifecycle("repository-lifecycle", {
      lifecycle: "disabled",
    }),
    {
      credential_type: "none",
      deletion_eligible: true,
      health: "healthy",
      health_error: null,
      id: "repository-lifecycle",
      lifecycle: "disabled",
      url: "https://example.com/lifecycle.git",
    },
  );
  assert.equal(alreadyCreatedWork.id, "repository-lifecycle");
  assert.throws(
    () => repositories.requireAcceptsNewWork("repository-lifecycle"),
    (error) =>
      error instanceof RepositoryError && error.code === "repository_disabled",
  );

  verificationFails = true;
  await assert.rejects(
    () =>
      repositories.setLifecycle("repository-lifecycle", {
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.deepEqual(repositories.list(), [
    {
      credential_type: "none",
      deletion_eligible: true,
      health: "error",
      health_error: {
        code: "repository_git_read_failed",
        message: "Repository Git read verification failed",
      },
      id: "repository-lifecycle",
      lifecycle: "disabled",
      url: "https://example.com/lifecycle.git",
    },
  ]);

  repositories.destroy();
  core.close();
  const reopened = openDurableCore(databasePath);
  assert.deepEqual(
    reopened.all(
      `SELECT lifecycle, health, health_error_code, health_error_message
       FROM repositories`,
    ),
    [
      {
        health: "error",
        health_error_code: "repository_git_read_failed",
        health_error_message: "Repository Git read verification failed",
        lifecycle: "disabled",
      },
    ],
  );
  assert.throws(
    () =>
      reopened.run(
        `UPDATE repositories
         SET health = 'healthy',
             health_error_code = 'stale_error',
             health_error_message = 'Stale observed failure'`,
      ),
    /repository_health_invalid/,
  );
  reopened.close();
  rmSync(directory, { force: true, recursive: true });
});

test("a stale disable cannot reverse concurrent Repository retirement", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-repository-disable-race-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO repositories
       (id, normalized_url, has_been_used, created_at, verified_at)
     VALUES ('repository-1', 'https://example.com/repository.git', 1, 1, 1)`,
  );
  let retireBeforeTransaction = true;
  const repositories = createRepositoryService(
    {
      all: core.all.bind(core),
      transaction(callback) {
        if (retireBeforeTransaction) {
          retireBeforeTransaction = false;
          core.run(
            "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
          );
        }
        return core.transaction(callback);
      },
    },
    { masterKey: Buffer.alloc(32, 29) },
  );

  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "disabled" }),
    { code: "repository_lifecycle_conflict" },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "retired",
  );
  repositories.destroy();
  core.close();
});
