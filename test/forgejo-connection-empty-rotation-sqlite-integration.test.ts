import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createForgejoConnectionService } from "../src/forgejo/forgejo-connection.ts";
import {
  availableStorageReserve,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.ts";

const repository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  outcome: "success",
  permissions: { admin: true, pull: true, push: true },
  private: true,
};

test("SQLite rotates global delivery authority with no active Forgejo Repositories", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-disabled-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const verificationInputs: any[] = [];
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 9),
    now: () => 1_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify(input) {
        verificationInputs.push(input);
        return {
          capabilities:
            input.repositoryIds?.length === 0
              ? {
                  enumeration: "verified",
                  private_git_read: "not_completed",
                }
              : { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo",
          reported_version: "16.0.4",
          repositories: input.repositoryIds?.length === 0 ? [] : [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled' WHERE id = 'repository-1'",
  );
  core.run(
    `INSERT INTO forgejo_delivery_attempts (
       surface, source_id, target, connection_id, authority_verified_at,
       attempt_count, last_attempt_at, error_code, error_detail, definitive
     ) VALUES (
       'aggregate_feedback', 'disabled-delivery', '{"repository_id":11}',
       'connection-1', 1000, 1, 1000,
       'forgejo_connection_credential_invalid', 'Forgejo PAT rejected', 1
     )`,
  );
  core.run("UPDATE forgejo_connections SET health = 'error'");

  const rotated = (await service.rotate({
    token: "replacement-pat",
  })) as NonNullable<Awaited<ReturnType<typeof service.read>>>;

  assert.equal(rotated?.health, "healthy");
  assert.deepEqual(verificationInputs[1]?.repositoryIds, []);
  assert.deepEqual(
    core.get(
      `SELECT trigger, capabilities, repositories, error_code
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    {
      capabilities: JSON.stringify({
        enumeration: "verified",
        private_git_read: "not_completed",
      }),
      error_code: null,
      repositories: "[]",
      trigger: "rotation",
    },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "disabled",
  );
  assert.deepEqual(
    core.get(
      `SELECT definitive, error_code FROM forgejo_delivery_attempts
       WHERE source_id = 'disabled-delivery'`,
    ),
    { definitive: 0, error_code: null },
  );
  service.destroy();
  core.close();
});
