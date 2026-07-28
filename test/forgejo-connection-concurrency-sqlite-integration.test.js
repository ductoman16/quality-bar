import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";

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
