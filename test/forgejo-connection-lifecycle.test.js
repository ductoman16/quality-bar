import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import {
  reactivateForgejoConnection,
  removeNeverUsedForgejoConnection,
  retireForgejoConnection,
} from "../src/forgejo-connection-lifecycle.js";
import { failedForgejoRepositoryChecks } from "../src/forgejo-repository-check.js";

function completeVerification() {
  return {
    capabilities: {
      aggregate_feedback: "verified",
      branch_access: "verified",
      commit_status: "verified",
      enumeration: "verified",
      inline_feedback: "verified",
      private_git_read: "verified",
      pull_request_access: "verified",
    },
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories: [
      {
        id: 11,
        outcome: "success",
        permissions: { admin: true, pull: true, push: true },
      },
    ],
    scopes: ["read:repository", "write:issue", "write:repository"],
  };
}

test("Forgejo lifecycle rejects malformed input before durable access", async () => {
  let reads = 0;
  const service = createForgejoConnectionService(
    {
      all() {
        reads += 1;
        return [];
      },
      transaction() {
        throw new Error("unused transaction");
      },
    },
    {
      masterKey: Buffer.alloc(32),
      verifier: { verify: async () => completeVerification() },
    },
  );
  const constructionReads = reads;
  assert.throws(() => service.retire({ lifecycle: "enabled" }), {
    code: "forgejo_connection_lifecycle_request_invalid",
  });
  await assert.rejects(() => service.reactivate({ token: "" }), {
    code: "forgejo_connection_reactivation_request_invalid",
  });
  assert.equal(reads, constructionReads);
  service.destroy();
});

test("Forgejo retirement decisions and PAT destruction are unit-owned", () => {
  /** @type {string[]} */
  const writes = [];
  const core = {
    all(/** @type {string} */ sql) {
      if (sql.includes("SELECT id, lifecycle")) {
        return [{ id: "connection-1", lifecycle: "enabled" }];
      }
      return sql.includes("repositories.lifecycle !=")
        ? []
        : [{ id: "repository-1" }];
    },
    transaction(/** @type {(transaction: any) => unknown} */ callback) {
      return callback({
        run(/** @type {string} */ sql) {
          writes.push(sql);
          return { changes: 1 };
        },
      });
    },
  };
  assert.equal(
    retireForgejoConnection(core, { lifecycle: "retired" }, () => "retired"),
    "retired",
  );
  assert.equal(writes.length, 2);
  assert.match(writes[0], /DELETE FROM forgejo_connection_credentials/);
  const neverUsed = {
    ...core,
    all(/** @type {string} */ sql) {
      return sql.includes("SELECT id, lifecycle")
        ? [{ id: "connection-1", lifecycle: "enabled" }]
        : [];
    },
  };
  assert.throws(
    () =>
      retireForgejoConnection(neverUsed, { lifecycle: "retired" }, () => null),
    { code: "forgejo_connection_retirement_unsupported" },
  );
});

test("Forgejo reactivation requires complete proof and records failure", async () => {
  /** @param {string[]} writes */
  function core(writes) {
    return {
      all(/** @type {string} */ sql) {
        return sql.includes("SELECT id, base_url")
          ? [
              {
                base_url: "https://forgejo.example",
                id: "connection-1",
                lifecycle: "retired",
                principal_id: 7,
                principal_login: "operator",
              },
            ]
          : [{ forge_repository_id: 11 }];
      },
      transaction(/** @type {(transaction: any) => unknown} */ callback) {
        return callback({
          run(/** @type {string} */ sql) {
            writes.push(sql);
            return { changes: 1 };
          },
        });
      },
    };
  }
  /** @type {string[]} */
  const successWrites = [];
  assert.equal(
    await reactivateForgejoConnection(
      {
        cipher: { encrypt: () => "encrypted" },
        createId: () => "verification-1",
        durableCore: core(successWrites),
        now: () => 1_000,
        readConnection: () => "enabled",
        verifier: { verify: async () => completeVerification() },
      },
      { token: "replacement-pat" },
    ),
    "enabled",
  );
  assert.equal(successWrites.length, 3);
  for (const malformed of [
    { ...completeVerification(), reported_version: "17.0.0" },
    { ...completeVerification(), scopes: ["read:repository"] },
    {
      ...completeVerification(),
      capabilities: { enumeration: "verified" },
    },
  ]) {
    /** @type {string[]} */
    const failureWrites = [];
    await assert.rejects(
      reactivateForgejoConnection(
        {
          cipher: { encrypt: () => "unused" },
          createId: () => "verification-2",
          durableCore: core(failureWrites),
          now: () => 2_000,
          readConnection: () => "unused",
          verifier: { verify: async () => malformed },
        },
        { token: "incomplete-pat" },
      ),
      { code: "forgejo_verification_result_invalid" },
    );
    assert.equal(failureWrites.length, 2);
    assert.match(failureWrites[1], /forgejo_connection_verifications/);
  }
});

test("failed Forgejo Repository checks require one exact discriminated record per dependent", () => {
  const coded = Object.assign(new Error("verification failed"), {
    code: "forgejo_verification_failed",
  });
  assert.deepEqual(failedForgejoRepositoryChecks(coded, [11]), [
    { forge_repository_id: 11, outcome: "not_completed" },
  ]);
  for (const repositoryChecks of [
    [
      { forge_repository_id: 11, outcome: "success" },
      { forge_repository_id: 11, outcome: "not_completed" },
    ],
    [{ forge_repository_id: 11, outcome: "error" }],
    [
      {
        error: { code: "", message: "failed" },
        forge_repository_id: 11,
        outcome: "error",
      },
    ],
  ]) {
    assert.throws(
      () =>
        failedForgejoRepositoryChecks(
          Object.assign(coded, { repositoryChecks }),
          repositoryChecks.length === 2 ? [11, 12] : [11],
        ),
      /Forgejo Repository verification checks are invalid/,
    );
  }
});

test("never-used Forgejo deletion is unit-owned as one transaction", () => {
  /** @type {string[]} */
  const writes = [];
  const core = {
    all(/** @type {string} */ sql) {
      return sql.includes("SELECT id FROM") ? [{ id: "connection-1" }] : [];
    },
    transaction(/** @type {(transaction: any) => unknown} */ callback) {
      return callback({
        run(/** @type {string} */ sql) {
          writes.push(sql);
          return { changes: 1 };
        },
      });
    },
  };
  removeNeverUsedForgejoConnection(core);
  assert.equal(writes.length, 5);
  assert.match(writes[3], /DELETE FROM forgejo_connections/);
});
