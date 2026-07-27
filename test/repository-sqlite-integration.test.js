import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService, RepositoryError } from "../src/repository.js";

test("a verified normalized Repository identity is inserted once and failed verification stores nothing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run("DROP TABLE repositories");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '8' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 8");
  prior.close();

  const core = openDurableCore(databasePath);
  assert.equal(core.facts.schemaVersion, 9);
  /** @type {string[]} */
  const verifiedUrls = [];
  const repositories = createRepositoryService(core, {
    createId: () => "repository-1",
    now: () => 47,
    async verifyRead(url) {
      verifiedUrls.push(url);
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
      repositories.registerPublic({
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

  const created = await repositories.registerPublic({
    url: "https://EXAMPLE.com:443/%7Eteam/repository.git/",
  });
  assert.deepEqual(created, {
    id: "repository-1",
    url: "https://example.com/~team/repository.git",
  });
  assert.deepEqual(verifiedUrls, [
    "https://example.com/unreachable.git",
    "https://example.com/~team/repository.git",
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
      repositories.registerPublic({
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
