import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import {
  createRepositoryService,
  RepositoryError,
} from "../src/repository/repository.ts";
import { createReviewService } from "../src/review/review.ts";

test("SQLite deletes only an unreferenced Repository and reactivates used identity after complete verification", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let verificationFails = false;
  const repositoryIds = [
    "repository-never-used",
    "repository-formerly-assigned",
    "repository-used",
  ];
  const repositories = createRepositoryService(core, {
    createId: () => repositoryIds.shift() ?? "unexpected-repository-id",
    masterKey: Buffer.alloc(32, 7),
    now: () => 60,
    async verifyRead() {
      if (verificationFails) {
        return Promise.reject(
          new RepositoryError(
            "repository_git_read_failed",
            "Repository Git read verification failed",
          ),
        );
      }
    },
  });
  await repositories.register({
    token: "never-used-token",
    url: "https://example.com/never-used.git",
    username: "operator",
  });
  await assert.rejects(
    repositories.setLifecycle("repository-never-used", {
      lifecycle: "retired",
    }),
    {
      code: "repository_retirement_unsupported",
      message: "A never-used Repository must be deleted",
    },
  );
  repositories.remove("repository-never-used");
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repository_credentials")?.count,
    0,
  );

  await repositories.register({
    url: "https://example.com/formerly-assigned.git",
  });
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `repository-lifecycle-review-${++next}`;
    })(),
    now: () => 61,
  });
  const review = reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Preserve Repository lifecycle history.",
      },
    ],
    description: "Repository lifecycle proof",
    name: "Repository lifecycle",
  });
  reviews.setAssignment(review.id, {
    repository_ids: ["repository-formerly-assigned"],
    scope: "repository_set",
  });
  reviews.setAssignment(review.id, { scope: "installation_wide" });
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM review_assignment_repositories WHERE repository_id = ?",
      "repository-formerly-assigned",
    )?.count,
    0,
  );
  assert.throws(() => repositories.remove("repository-formerly-assigned"), {
    code: "repository_delete_unsupported",
  });
  assert.equal(
    (
      await repositories.setLifecycle("repository-formerly-assigned", {
        lifecycle: "retired",
      })
    ).lifecycle,
    "retired",
  );

  await repositories.register({
    token: "original-token",
    url: "https://example.com/used.git",
    username: "operator",
  });
  reviews.setAssignment(review.id, {
    repository_ids: ["repository-used"],
    scope: "repository_set",
  });
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance, base_selector_type, base_selector_value,
       head_selector_type, head_selector_value, base_commit, head_commit,
       execution_status, created_at, completed_at
     ) VALUES (?, ?, 'explicit', 'commit', ?, 'commit', ?, ?, ?, 'completed', ?, ?)`,
    "evaluation-preserved",
    "repository-used",
    "a".repeat(40),
    "b".repeat(40),
    "a".repeat(40),
    "b".repeat(40),
    62,
    62,
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES (?, 'clear', ?)",
    "evaluation-preserved",
    62,
  );

  assert.throws(() => repositories.remove("repository-used"), {
    code: "repository_delete_unsupported",
    message: "A referenced Repository must be retired",
  });
  assert.deepEqual(
    await repositories.setLifecycle("repository-used", {
      lifecycle: "retired",
    }),
    {
      credential_type: "none",
      deletion_eligible: false,
      health: "healthy",
      health_error: null,
      id: "repository-used",
      lifecycle: "retired",
      url: "https://example.com/used.git",
    },
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM repository_credentials WHERE repository_id = ?",
      "repository-used",
    )?.count,
    0,
  );

  verificationFails = true;
  await assert.rejects(
    repositories.register({
      token: "rejected-token",
      url: "https://example.com/used.git",
      username: "operator",
    }),
    { code: "repository_git_read_failed" },
  );
  assert.deepEqual(
    repositories.list().find(({ id }) => id === "repository-used"),
    {
      credential_type: "none",
      deletion_eligible: false,
      health: "error",
      health_error: {
        code: "repository_git_read_failed",
        message: "Repository Git read verification failed",
      },
      id: "repository-used",
      lifecycle: "retired",
      url: "https://example.com/used.git",
    },
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM repository_credentials WHERE repository_id = ?",
      "repository-used",
    )?.count,
    0,
  );

  verificationFails = false;
  assert.deepEqual(
    await repositories.register({
      token: "replacement-token",
      url: "https://example.com/used.git",
      username: "operator",
    }),
    {
      credential_type: "username_token",
      deletion_eligible: false,
      health: "healthy",
      health_error: null,
      id: "repository-used",
      lifecycle: "enabled",
      url: "https://example.com/used.git",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    2,
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM review_assignment_repositories WHERE repository_id = ?",
      "repository-used",
    )?.count,
    1,
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM evaluations WHERE repository_id = ?",
      "repository-used",
    )?.count,
    1,
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE repositories SET has_been_used = 0 WHERE id = ?",
        "repository-used",
      ),
    /repository_usage_immutable/,
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM evaluation_results
       WHERE evaluation_id = 'evaluation-preserved'`,
    )?.count,
    1,
  );
  await assert.rejects(
    repositories.register({ url: "https://example.com/used.git" }),
    { code: "repository_identity_conflict" },
  );
  await repositories.setLifecycle("repository-used", {
    lifecycle: "retired",
  });
  const verificationRequests = [
    Promise.withResolvers(),
    Promise.withResolvers(),
  ];
  let verificationRequest = 0;
  const racingRepositories = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
    verifyRead: () =>
      verificationRequests[verificationRequest++].promise.then(() => {}),
  });
  const firstReactivation = racingRepositories.register({
    token: "first-concurrent-token",
    url: "https://example.com/used.git",
    username: "operator",
  });
  const secondReactivation = racingRepositories.register({
    token: "second-concurrent-token",
    url: "https://example.com/used.git",
    username: "operator",
  });
  verificationRequests[0].resolve(undefined);
  await firstReactivation;
  verificationRequests[1].resolve(undefined);
  await assert.rejects(secondReactivation, {
    code: "repository_lifecycle_conflict",
    message: "Repository changed during reactivation",
  });
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM repository_credentials WHERE repository_id = ?",
      "repository-used",
    )?.count,
    1,
  );
  racingRepositories.destroy();
  repositories.destroy();
  core.close();
});

test("Generic Repository enablement rejects a newer enable-disable ABA transition", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-repository-aba-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let releaseOldVerification: () => void = () => {};
  const oldVerificationGate = new Promise((resolve) => {
    releaseOldVerification = () => resolve(undefined);
  });
  let markOldVerificationStarted: () => void = () => {};
  const oldVerificationStarted = new Promise((resolve) => {
    markOldVerificationStarted = () => resolve(undefined);
  });
  let enablementVerificationCount = 0;
  let blockEnablement = false;
  const repositories = createRepositoryService(core, {
    createId: () => "repository-aba",
    masterKey: Buffer.alloc(32, 24),
    now: () => 70,
    async verifyRead() {
      if (blockEnablement && ++enablementVerificationCount === 1) {
        markOldVerificationStarted();
        await oldVerificationGate;
      }
    },
  });
  await repositories.register({ url: "https://example.com/aba.git" });
  await repositories.setLifecycle("repository-aba", {
    lifecycle: "disabled",
  });
  blockEnablement = true;
  const oldEnablement = repositories.setLifecycle("repository-aba", {
    lifecycle: "enabled",
  });
  await oldVerificationStarted;
  await repositories.setLifecycle("repository-aba", {
    lifecycle: "enabled",
  });
  await repositories.setLifecycle("repository-aba", {
    lifecycle: "disabled",
  });
  releaseOldVerification();

  await assert.rejects(oldEnablement, {
    code: "repository_lifecycle_conflict",
  });
  assert.deepEqual(
    core.get(
      `SELECT lifecycle, lifecycle_revision
       FROM repositories WHERE id = 'repository-aba'`,
    ),
    { lifecycle: "disabled", lifecycle_revision: 3 },
  );
  repositories.destroy();
  core.close();
});
