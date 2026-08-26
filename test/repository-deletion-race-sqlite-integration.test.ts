import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createRepositoryService } from "../src/repository/repository.ts";

test("Repository hard deletion rejects a newer disable-enable ABA transition", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-repository-delete-race-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO repositories (id, normalized_url, created_at, verified_at)
     VALUES ('repository-1', 'https://example.com/repository.git', 1, 1)`,
  );
  let changeBeforeDelete = true;
  const repositories = createRepositoryService(
    {
      all: core.all.bind(core),
      transaction(callback) {
        if (changeBeforeDelete) {
          changeBeforeDelete = false;
          core.run(
            `UPDATE repositories
             SET lifecycle = 'disabled',
                 lifecycle_revision = lifecycle_revision + 1
             WHERE id = 'repository-1'`,
          );
          core.run(
            `UPDATE repositories
             SET lifecycle = 'enabled',
                 lifecycle_revision = lifecycle_revision + 1
             WHERE id = 'repository-1'`,
          );
        }
        return core.transaction(callback);
      },
    },
    { masterKey: Buffer.alloc(32, 26) },
  );

  assert.throws(() => repositories.remove("repository-1"), {
    code: "repository_lifecycle_conflict",
  });
  assert.deepEqual(
    core.get(
      `SELECT lifecycle, lifecycle_revision
       FROM repositories WHERE id = 'repository-1'`,
    ),
    { lifecycle: "enabled", lifecycle_revision: 2 },
  );
  repositories.destroy();
  core.close();
});
