import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryService, RepositoryError } from "../src/repository.js";

/**
 * @param {Record<string, import("node:sqlite").SQLInputValue>[]} rows
 * @param {number} [changes]
 */
function fakeDurableCore(rows, changes = 1) {
  let transactions = 0;
  return {
    /**
     * @param {string} sql
     * @param {import("node:sqlite").SQLInputValue[]} parameters
     */
    all(sql, ...parameters) {
      void parameters;
      if (sql.includes("LEFT JOIN repository_credentials")) {
        return rows;
      }
      return [];
    },
    get transactionCount() {
      return transactions;
    },
    /**
     * @template Result
     * @param {(transaction: {
     *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
     * }) => Result} callback
     * @returns {Result}
     */
    transaction(callback) {
      transactions += 1;
      return callback({
        run(sql, ...parameters) {
          void sql;
          void parameters;
          return { changes, lastInsertRowid: 0 };
        },
      });
    },
  };
}

test("credential rotation rejects missing and public Repositories before verification or persistence", async () => {
  /** @type {Record<string, import("node:sqlite").SQLInputValue>[]} */
  const rows = [];
  const core = fakeDurableCore(rows);
  let verifications = 0;
  const repositories = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
    async verifyRead() {
      verifications += 1;
    },
  });
  const replacement = {
    token: "replacement-private-token",
    username: "replacement-operator",
  };

  await assert.rejects(
    () => repositories.rotateCredential("repository-absent", replacement),
    (error) =>
      error instanceof RepositoryError && error.code === "repository_not_found",
  );
  rows.push({
    encrypted_credential: null,
    normalized_url: "https://example.com/public.git",
  });
  await assert.rejects(
    () => repositories.rotateCredential("repository-public", replacement),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_credential_not_found",
  );
  assert.equal(verifications, 0);
  assert.equal(core.transactionCount, 0);
  repositories.destroy();
});

test("Repository listing exposes lifecycle and health without credential values", () => {
  /** @type {string[]} */
  const reads = [];
  const repositories = createRepositoryService(
    {
      all(sql) {
        reads.push(sql);
        return sql.includes("ORDER BY repositories.normalized_url")
          ? [
              {
                encrypted_credential: "encrypted-value",
                has_been_used: 0,
                health: "healthy",
                health_error_code: null,
                health_error_message: null,
                id: "repository-private",
                lifecycle: "enabled",
                normalized_url: "https://example.com/private.git",
              },
            ]
          : [];
      },
      transaction() {
        throw new Error("unused Repository transaction");
      },
    },
    { masterKey: Buffer.alloc(32, 7) },
  );

  assert.deepEqual(repositories.list(), [
    {
      credential_type: "username_token",
      deletion_eligible: true,
      health: "healthy",
      health_error: null,
      id: "repository-private",
      lifecycle: "enabled",
      url: "https://example.com/private.git",
    },
  ]);
  assert.match(reads.at(-1) ?? "", /LEFT JOIN repository_credentials/);
  assert.doesNotMatch(
    JSON.stringify(repositories.list()),
    /encrypted-value|token-value/,
  );
  repositories.destroy();
});

test("credential rotation discards failed and stale replacements without an inferred success", async () => {
  const row = {
    encrypted_credential: "original-encrypted-credential",
    normalized_url: "https://example.com/private.git",
  };
  const core = fakeDurableCore([row], 0);
  /** @type {object[]} */
  const verifications = [];
  const repositories = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
    async verifyRead(url, credential) {
      verifications.push({ credential, url });
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

  await assert.rejects(
    () =>
      repositories.rotateCredential("repository-private", {
        token: "rejected-replacement",
        username: "replacement-operator",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.equal(core.transactionCount, 0);
  await assert.rejects(
    () =>
      repositories.rotateCredential("repository-private", {
        token: "verified-replacement",
        username: "replacement-operator",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_credential_rotation_conflict",
  );
  assert.equal(core.transactionCount, 1);
  assert.equal(row.encrypted_credential, "original-encrypted-credential");
  assert.deepEqual(verifications, [
    {
      credential: {
        token: "rejected-replacement",
        username: "replacement-operator",
      },
      url: row.normalized_url,
    },
    {
      credential: {
        token: "verified-replacement",
        username: "replacement-operator",
      },
      url: row.normalized_url,
    },
  ]);
  repositories.destroy();
});
