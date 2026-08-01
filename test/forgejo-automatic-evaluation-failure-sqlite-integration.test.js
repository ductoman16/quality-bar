import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import {
  forgejoVerification,
  pullRequest,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("a Forgejo PR acquisition failure stays local and skips no sibling Repository", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let currentTime = 1_000;
  let ready = false;
  /** @type {number[]} */
  const acquisitions = [];
  let releases = 0;
  let authenticationFailure = false;
  /** @type {number | null} */
  let mixedObjectRepository = null;
  /** @type {number[]} */
  const polled = [];
  const connection = createForgejoConnectionService(core, {
    async acquirePullRequestChangeset({ pullRequest: candidate }) {
      acquisitions.push(candidate.number);
      if (authenticationFailure) {
        throw Object.assign(new Error("Repository authentication failed"), {
          code: "repository_authentication_failed",
        });
      }
      if (candidate.number === 11) {
        throw Object.assign(
          new Error("Forgejo pull request head is inaccessible"),
          { code: "forgejo_pull_request_head_inaccessible" },
        );
      }
      if (candidate.number === 12) {
        throw Object.assign(new Error("Repository permission denied"), {
          code: "repository_permission_denied",
        });
      }
      if (candidate.number === 13) {
        throw Object.assign(new Error("Repository disappeared"), {
          code: "repository_git_read_failed",
        });
      }
      if (candidate.number === 14) {
        throw Object.assign(new Error("Git fetch failed"), {
          code: "evaluation_git_acquisition_failed",
        });
      }
      return {
        base_commit: candidate.merge_base,
        head_commit: candidate.head.sha,
        release: () => (releases += 1),
      };
    },
    admitAutomaticEvaluation: () => ({
      afterCommit() {},
      resource: { id: "evaluation-13" },
    }),
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-11",
        "repository-12",
        "repository-13",
        "repository-14",
        "repository-15",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 8),
    now: () => currentTime,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests(connectionInput, repository) {
        assert.equal(connectionInput.baseUrl, "https://forgejo.example");
        polled.push(repository.id);
        if (repository.id === mixedObjectRepository) {
          return [
            pullRequest(repository.id, {
              head: { sha: "b".repeat(64) },
            }),
          ];
        }
        return [pullRequest(repository.id, { draft: !ready })];
      },
      async verify() {
        return forgejoVerification([
          repositoryEvidence(11, "one"),
          repositoryEvidence(12, "two"),
          repositoryEvidence(13, "three"),
          repositoryEvidence(14, "four"),
          repositoryEvidence(15, "five"),
        ]);
      },
    },
  });
  await connection.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 12, 13, 14, 15],
    token: "pat",
  });

  ready = true;
  currentTime = 61_000;
  await connection.runPolling();

  assert.deepEqual(acquisitions, [11, 12, 13, 14, 15]);
  assert.equal(releases, 1);
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'forgejo_poll_gate:connection-1'",
    ),
    undefined,
  );
  assert.deepEqual(
    core.all(
      `SELECT forge_repository_id, error_code, error_message, snapshot
         FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    [
      {
        error_code: "forgejo_pull_request_head_inaccessible",
        error_message: `Forgejo pull request #11 head ${pullRequest(11).head.sha} is inaccessible`,
        forge_repository_id: 11,
        snapshot: JSON.stringify([pullRequest(11, { draft: true })]),
      },
      {
        error_code: "repository_permission_denied",
        error_message: `Forgejo pull request #12 at merge-base ${pullRequest(12).merge_base} and head ${pullRequest(12).head.sha}: Repository permission denied`,
        forge_repository_id: 12,
        snapshot: JSON.stringify([pullRequest(12, { draft: true })]),
      },
      {
        error_code: "repository_git_read_failed",
        error_message: `Forgejo pull request #13 at merge-base ${pullRequest(13).merge_base} and head ${pullRequest(13).head.sha}: Repository disappeared`,
        forge_repository_id: 13,
        snapshot: JSON.stringify([pullRequest(13, { draft: true })]),
      },
      {
        error_code: "evaluation_git_acquisition_failed",
        error_message: `Forgejo pull request #14 at merge-base ${pullRequest(14).merge_base} and head ${pullRequest(14).head.sha}: Git fetch failed`,
        forge_repository_id: 14,
        snapshot: JSON.stringify([pullRequest(14, { draft: true })]),
      },
      {
        error_code: null,
        error_message: null,
        forge_repository_id: 15,
        snapshot: JSON.stringify([pullRequest(15)]),
      },
    ],
  );
  assert.deepEqual(
    core.all(
      "SELECT id, health, health_error_code FROM repositories ORDER BY id",
    ),
    [
      { health: "healthy", health_error_code: null, id: "repository-11" },
      {
        health: "error",
        health_error_code: "repository_permission_denied",
        id: "repository-12",
      },
      {
        health: "error",
        health_error_code: "repository_git_read_failed",
        id: "repository-13",
      },
      { health: "healthy", health_error_code: null, id: "repository-14" },
      { health: "healthy", health_error_code: null, id: "repository-15" },
    ],
  );

  mixedObjectRepository = 11;
  currentTime = 121_000;
  await connection.runPolling();
  assert.deepEqual(polled.slice(-3), [11, 14, 15]);
  assert.equal(
    core.get(
      "SELECT error_code FROM forgejo_repository_polls WHERE forge_repository_id = 11",
    )?.error_code,
    "forgejo_poll_response_invalid",
  );
  assert.equal(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'forgejo_poll_gate:connection-1'",
    ),
    undefined,
  );

  mixedObjectRepository = null;
  authenticationFailure = true;
  currentTime = 181_000;
  await connection.runPolling();
  assert.equal(
    core.get("SELECT health FROM forgejo_connections")?.health,
    "error",
  );
  assert.deepEqual(acquisitions.slice(-1), [14]);
  assert.match(
    String(
      core.get(
        "SELECT value FROM quality_bar_metadata WHERE key = 'forgejo_poll_gate:connection-1'",
      )?.value ?? "",
    ),
    /repository_authentication_failed/,
  );
  connection.destroy();
  core.close();
});
