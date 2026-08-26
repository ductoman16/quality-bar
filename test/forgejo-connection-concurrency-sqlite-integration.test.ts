import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAvailableForgejoConnectionService as createForgejoConnectionService } from "./storage-reserve-support.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { createRepositoryService } from "../src/repository/repository.ts";
import {
  forgejoVerification,
  pullRequest,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.ts";

const privateRepository = repositoryEvidence(11, "private");

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
          profile: "forgejo",
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
  await assert.rejects(stalePoll, { code: "forgejo_polling_conflict" });

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

test("a definitive Connection failure stops remaining Forgejo Repository polls", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-gate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let currentTime = 1_000;
  let failPolling = false;
  const attempted: number[] = [];
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "repository-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 25),
    now: () => currentTime,
    verifier: {
      async listPullRequests(connection, repository) {
        assert.equal(connection.token, "pat");
        if (failPolling) {
          attempted.push(repository.id);
          throw Object.assign(new Error("Forgejo PAT is no longer valid"), {
            code: "forgejo_connection_credential_invalid",
          });
        }
        return [pullRequest(repository.id)];
      },
      async verify() {
        return forgejoVerification([
          repositoryEvidence(11, "one"),
          repositoryEvidence(22, "two"),
        ]);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "pat",
  });

  currentTime = 61_000;
  failPolling = true;
  await forgejo.runPolling();
  assert.deepEqual(attempted, [11]);
  assert.equal(forgejo.read()?.health, "error");
  assert.deepEqual(forgejo.read()?.health_error, {
    code: "forgejo_connection_credential_invalid",
    message: "Forgejo PAT is no longer valid",
  });
  forgejo.destroy();
  core.close();
});

test("a Forgejo rate gate advances every sibling Repository schedule", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-rate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let currentTime = 1_000;
  const attempted: number[] = [];
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "repository-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 27),
    now: () => currentTime,
    verifier: {
      async listPullRequests(connection, candidate) {
        assert.equal(connection.token, "pat");
        if (currentTime > 1_000) {
          attempted.push(candidate.id);
          throw Object.assign(new Error("Forgejo polling rate limited"), {
            code: "forgejo_api_rate_limited",
            nextAttemptAt: 125_000,
            rateGateUntil: 125_000,
            repositoryId: candidate.id,
          });
        }
        return [pullRequest(candidate.id)];
      },
      async verify() {
        return forgejoVerification([
          repositoryEvidence(11, "one"),
          repositoryEvidence(22, "two"),
        ]);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "pat",
  });

  currentTime = 61_000;
  await forgejo.runPolling();
  await forgejo.runPolling();
  assert.deepEqual(attempted, [11]);
  assert.deepEqual(
    core
      .all(
        `SELECT next_attempt_at FROM forgejo_repository_polls
          ORDER BY forge_repository_id`,
      )
      .map((row) => row?.next_attempt_at),
    [125_000, 125_000],
  );
  forgejo.destroy();
  core.close();
});

test("PAT rotation fences an older Repository re-enablement", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-enable-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const masterKey = Buffer.alloc(32, 26);
  const evidence = repositoryEvidence(11, "private");
  let blockOldVerification = false;
  let releaseOldVerification = () => {};
  let announceOldVerification = () => {};
  const oldVerificationStarted = new Promise((resolve) => {
    announceOldVerification = () => resolve(undefined);
  });
  const oldVerificationReleased = new Promise((resolve) => {
    releaseOldVerification = () => resolve(undefined);
  });
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "enablement-verification-1",
        "rotation-verification-1",
      ];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => 1_000,
    verifier: {
      async listPullRequests(connection) {
        return [pullRequest(connection.token === "replacement-pat" ? 2 : 1)];
      },
      async verify({ repositoryIds, token }) {
        if (blockOldVerification && token === "old-pat") {
          announceOldVerification();
          await oldVerificationReleased;
        }
        return forgejoVerification(
          repositoryIds.includes(11) ? [evidence] : [],
        );
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "old-pat",
  });
  const repositories = createRepositoryService(core, {
    masterKey,
    now: () => 2_000,
    verifyForgeRepository: (forgeRepositoryId) =>
      forgejo.prepareRepositoryEnablement(forgeRepositoryId),
  });
  await repositories.setLifecycle("repository-1", { lifecycle: "disabled" });

  blockOldVerification = true;
  const staleEnablement = repositories.setLifecycle("repository-1", {
    lifecycle: "enabled",
  });
  await oldVerificationStarted;
  await forgejo.rotate({ token: "replacement-pat" });
  releaseOldVerification();
  await assert.rejects(
    () => staleEnablement,
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_repository_enablement_conflict",
  );
  assert.equal(repositories.list()[0]?.lifecycle, "disabled");
  assert.equal(
    core.get("SELECT snapshot FROM forgejo_repository_polls")?.snapshot,
    JSON.stringify([pullRequest(1)]),
  );
  repositories.destroy();
  forgejo.destroy();
  core.close();
});
