import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createAvailableGitHubConnectionService } from "./storage-reserve-support.ts";

const capabilities = {
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
};
const app = {
  app_id: 47,
  app_slug: "quality-bar-personal",
  client_id: "Iv1.client-secret",
  owner: { id: 91, login: "operator", type: "User" },
  pem: "old-private-key-secret",
};
const repository = {
  api_url: "https://api.github.com/repos/operator/private",
  clone_url: "https://github.com/operator/private.git",
  full_name: "operator/private",
  html_url: "https://github.com/operator/private",
  id: 101,
  private: true,
};

test("GitHub App rotation keeps replacement and predecessor credentials out of durable evidence", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-rotation-security-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const registeredSecrets: string[] = [];
  const service = createAvailableGitHubConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "verification-rotation"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 3),
    now: () => 2_000,
    registerSecret(secret) {
      if (secret) {
        registeredSecrets.push(secret);
      }
    },
    verifier: {
      async exchangeManifest() {
        return app;
      },
      async listPullRequests() {
        return [];
      },
      async verifyInstallation() {
        return {
          capabilities,
          principal: repositoryPrincipal(),
          repositories: [repository],
        };
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });
  core.run(
    `INSERT INTO repositories (id, normalized_url, lifecycle, created_at, verified_at)
     VALUES ('repository-1', 'https://github.com/operator/private.git', 'enabled', 1000, 1000)`,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name,
       api_url, web_url, verification_id
     ) VALUES ('repository-1', 'connection-1', 101, 'operator/private',
       'https://api.github.com/repos/operator/private',
       'https://github.com/operator/private', 'verification-1')`,
  );
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status,
       last_success_at, next_attempt_at, snapshot
     ) VALUES ('connection-1', 101, 'complete', 1000, 61000, '[]')`,
  );
  await service.rotate({ pem: "new-private-key-secret" });
  const evidence = JSON.stringify({
    history: core.all("SELECT * FROM github_connection_verifications"),
    repositories: core.all("SELECT * FROM repositories"),
    connection: service.read(),
  });
  assert.doesNotMatch(
    evidence,
    /old-private-key-secret|new-private-key-secret|Iv1\.client-secret/,
  );
  assert.ok(registeredSecrets.includes("old-private-key-secret"));
  assert.ok(registeredSecrets.includes("new-private-key-secret"));
  service.destroy();
  core.close();
});

function repositoryPrincipal() {
  return { id: 91, login: "operator", type: "User" };
}
