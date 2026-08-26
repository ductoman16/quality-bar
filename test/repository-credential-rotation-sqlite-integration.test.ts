import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createRepositoryCredentialCipher } from "../src/repository/repository-credential.ts";
import {
  createRepositoryService,
  RepositoryError,
} from "../src/repository/repository.ts";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-rotation-"));
  return {
    core: openDurableCore(join(directory, "quality-bar.sqlite3")),
    directory,
  };
}

test("credential rotation verifies before one atomic secret swap and preserves the active credential on failure", async (context) => {
  const { core, directory } = temporaryDatabase();
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  let timestamp = 48;
  const repositories = createRepositoryService(core, {
    createId: () => "repository-private",
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    async verifyRead(url, credential) {
      assert.equal(url, "https://example.com/private.git");
      if (credential?.token === "rejected-replacement") {
        return Promise.reject(
          new RepositoryError(
            "repository_git_read_failed",
            "Repository Git read verification failed",
          ),
        );
      }
    },
  });
  context.after(() => repositories.destroy());
  context.after(() => core.close());
  const repository = await repositories.register({
    token: "original-private-token",
    url: "https://example.com/private.git",
    username: "original-operator",
  });
  const original = (
    core.get(
      "SELECT encrypted_credential FROM repository_credentials WHERE repository_id = ?",
      repository.id,
    ) as { encrypted_credential: string }
  ).encrypted_credential;

  timestamp = 49;
  await assert.rejects(
    () =>
      repositories.rotateCredential(repository.id, {
        token: "rejected-replacement",
        username: "replacement-operator",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.deepEqual(
    core.get(
      `SELECT
         repository_credentials.encrypted_credential,
         repository_credentials.created_at,
         repositories.verified_at
       FROM repositories
       JOIN repository_credentials
         ON repository_credentials.repository_id = repositories.id
       WHERE repositories.id = ?`,
      repository.id,
    ),
    {
      created_at: 48,
      encrypted_credential: original,
      verified_at: 48,
    },
  );

  core.run(
    `UPDATE repositories
     SET health = 'error',
         health_error_code = 'repository_git_read_failed',
         health_error_message = 'Repository Git read verification failed'
     WHERE id = ?`,
    repository.id,
  );
  const rotated = await repositories.rotateCredential(repository.id, {
    token: "replacement-private-token",
    username: "replacement-operator",
  });
  assert.deepEqual(rotated, repository);
  const active = core.get(
    `SELECT
         repository_credentials.encrypted_credential,
         repository_credentials.created_at,
         repositories.health,
         repositories.health_error_code,
         repositories.health_error_message,
         repositories.verified_at
       FROM repositories
       JOIN repository_credentials
         ON repository_credentials.repository_id = repositories.id
       WHERE repositories.id = ?`,
    repository.id,
  ) as {
    created_at: number;
    encrypted_credential: string;
    health: string;
    health_error_code: null;
    health_error_message: null;
    verified_at: number;
  };
  assert.equal(active.created_at, 49);
  assert.equal(active.verified_at, 49);
  assert.equal(active.health, "healthy");
  assert.equal(active.health_error_code, null);
  assert.equal(active.health_error_message, null);
  assert.notEqual(active.encrypted_credential, original);
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM repository_credentials WHERE repository_id = ?",
      repository.id,
    )?.count,
    1,
  );
  const cipher = createRepositoryCredentialCipher(Buffer.alloc(32, 7));
  context.after(() => cipher.destroy());
  assert.deepEqual(cipher.decrypt(repository, active.encrypted_credential), {
    token: "replacement-private-token",
    username: "replacement-operator",
  });
});

test("overlapping verified rotations cannot overwrite a credential that changed while verification ran", async (context) => {
  const { core, directory } = temporaryDatabase();
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const releaseVerification: (() => void)[] = [];
  const repositories = createRepositoryService(core, {
    createId: () => "repository-private",
    masterKey: Buffer.alloc(32, 7),
    async verifyRead(url, credential) {
      assert.equal(url, "https://example.com/private.git");
      if (credential?.token !== "original-private-token") {
        await new Promise((resolve) =>
          releaseVerification.push(() => resolve(undefined)),
        );
      }
    },
  });
  context.after(() => repositories.destroy());
  context.after(() => core.close());
  const repository = await repositories.register({
    token: "original-private-token",
    url: "https://example.com/private.git",
    username: "original-operator",
  });

  const first = repositories.rotateCredential(repository.id, {
    token: "first-replacement-token",
    username: "first-replacement-operator",
  });
  const second = repositories.rotateCredential(repository.id, {
    token: "second-replacement-token",
    username: "second-replacement-operator",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releaseVerification.length, 2);
  releaseVerification[0]();
  await first;
  releaseVerification[1]();
  await assert.rejects(
    () => second,
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_credential_rotation_conflict",
  );

  const active = (
    core.get(
      "SELECT encrypted_credential FROM repository_credentials WHERE repository_id = ?",
      repository.id,
    ) as { encrypted_credential: string }
  ).encrypted_credential;
  const cipher = createRepositoryCredentialCipher(Buffer.alloc(32, 7));
  context.after(() => cipher.destroy());
  assert.deepEqual(cipher.decrypt(repository, active), {
    token: "first-replacement-token",
    username: "first-replacement-operator",
  });
});
