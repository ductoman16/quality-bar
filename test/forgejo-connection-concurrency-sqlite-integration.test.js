import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService } from "../src/repository.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";

const privateRepository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  outcome: "success",
  permissions: { admin: true, pull: true, push: true },
  private: true,
};

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
      async listPullRequests() {
        return [];
      },
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
          repositories: [privateRepository],
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

/** @param {number} number */
function pullRequest(number) {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merged: false,
    merged_at: null,
    number,
    state: "open",
  };
}

test("a corrected Forgejo baseline fences an older in-flight poll", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const evidence = repositoryEvidence(11, "private");
  let currentTime = 1_000;
  let blockOldPoll = false;
  let releaseOldPoll = () => {};
  let announceOldPoll = () => {};
  const oldPollStarted = new Promise((resolve) => {
    announceOldPoll = () => resolve(undefined);
  });
  const oldPollReleased = new Promise((resolve) => {
    releaseOldPoll = () => resolve(undefined);
  });
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "rotation-verification-1",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 23),
    now: () => currentTime,
    verifier: {
      async listPullRequests(connection) {
        if (blockOldPoll && connection.token === "old-pat") {
          announceOldPoll();
          await oldPollReleased;
          return [pullRequest(99)];
        }
        return [pullRequest(connection.token === "replacement-pat" ? 2 : 1)];
      },
      async verify() {
        return forgejoVerification([evidence]);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "old-pat",
  });

  currentTime = 61_000;
  blockOldPoll = true;
  const stalePoll = forgejo.runPolling();
  await oldPollStarted;
  await forgejo.rotate({ token: "replacement-pat" });
  releaseOldPoll();
  await stalePoll;

  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      last_success_at: 61_000,
      next_attempt_at: 121_000,
      snapshot: JSON.stringify([pullRequest(2)]),
    },
  );
  forgejo.destroy();
  core.close();
});

test("Repository admission preserves a connection-owned Forgejo polling error", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-error-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const masterKey = Buffer.alloc(32, 24);
  let currentTime = 1_000;
  let failure = false;
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => currentTime,
    verifier: {
      async listPullRequests() {
        if (failure) {
          throw Object.assign(new Error("Forgejo PAT is no longer valid"), {
            code: "forgejo_connection_credential_invalid",
          });
        }
        return [pullRequest(1)];
      },
      async verify() {
        return forgejoVerification([repositoryEvidence(11, "private")]);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });

  currentTime = 61_000;
  failure = true;
  await forgejo.runPolling();
  const repositories = createRepositoryService(core, {
    masterKey,
    now: () => currentTime,
    verifyForgeRepository: (forgeRepositoryId) =>
      forgejo.prepareRepositoryEnablement(forgeRepositoryId),
  });
  assert.throws(
    () => repositories.requireAcceptsNewWork("repository-1"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_connection_credential_invalid" &&
      error.message === "Forgejo PAT is no longer valid",
  );
  repositories.destroy();
  forgejo.destroy();
  core.close();
});
