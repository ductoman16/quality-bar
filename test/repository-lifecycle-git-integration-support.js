import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { join } from "node:path";

import { openDurableCore } from "../src/durable/durable-core.js";
import { verifyRepositoryRead } from "../src/repository/repository-git.js";
import { createRepositoryGuidanceService } from "../src/repository/repository-guidance.js";
import { createRepositoryService } from "../src/repository/repository.js";
import { RepositoryError } from "../src/repository/repository-validation.js";
import { createReviewService } from "../src/review/review.js";

/** @param {string} directory @param {string} certificate @param {number} port */
export async function assertRepositoryLifecycleOverRealGit(
  directory,
  certificate,
  port,
) {
  const lifecycleCore = openDurableCore(
    join(directory, "repository-lifecycle.sqlite3"),
  );
  const lifecycleRepositories = createRepositoryService(lifecycleCore, {
    createId: () => "repository-lifecycle",
    masterKey: Buffer.alloc(32, 7),
    async verifyRead(url, credential) {
      await verifyRepositoryRead(url, credential, {
        certificateAuthorityPath: certificate,
      });
    },
  });
  await lifecycleRepositories.register({
    url: `https://127.0.0.1:${port}/populated.git`,
  });
  const reviews = createReviewService(lifecycleCore, {
    createId: (() => {
      let next = 0;
      return () => `git-assignment-fact-${++next}`;
    })(),
  });
  /** @param {string} name */
  const reviewDefinition = (name) => ({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Keep verified Repository scope exact.",
      },
    ],
    description: "Select only admitted Git Repositories.",
    name,
  });
  const installationWide = reviews.create(
    reviewDefinition("Verified Git installation-wide"),
  );
  const repositorySpecific = reviews.create(
    reviewDefinition("Verified Git Repository"),
  );
  reviews.setAssignment(repositorySpecific.id, {
    repository_ids: ["repository-lifecycle"],
    scope: "repository_set",
  });
  assert.deepEqual(
    reviews.selectForNewEvaluation("repository-lifecycle"),
    [installationWide, repositorySpecific].map((review) => ({
      review_id: review.id,
      review_version_id: review.active_version.id,
    })),
  );
  const guidance = createRepositoryGuidanceService(lifecycleCore).read(
    "repository-lifecycle",
  );
  assert.deepEqual(
    guidance.reviews.map(({ id }) => id),
    [installationWide.id, repositorySpecific.id],
  );
  await lifecycleRepositories.setLifecycle("repository-lifecycle", {
    lifecycle: "disabled",
  });
  renameSync(
    join(directory, "populated.git"),
    join(directory, "populated-unavailable.git"),
  );
  await assert.rejects(
    lifecycleRepositories.setLifecycle("repository-lifecycle", {
      lifecycle: "enabled",
    }),
    { code: "repository_git_read_failed" },
  );
  assert.deepEqual(lifecycleRepositories.list()[0].health_error, {
    code: "repository_git_read_failed",
    message: "Repository Git read verification failed",
  });
  renameSync(
    join(directory, "populated-unavailable.git"),
    join(directory, "populated.git"),
  );
  assert.equal(
    (
      await lifecycleRepositories.setLifecycle("repository-lifecycle", {
        lifecycle: "enabled",
      })
    ).health,
    "healthy",
  );
  assert.equal(
    (
      await lifecycleRepositories.setLifecycle("repository-lifecycle", {
        lifecycle: "retired",
      })
    ).lifecycle,
    "retired",
  );
  renameSync(
    join(directory, "populated.git"),
    join(directory, "populated-unavailable.git"),
  );
  await assert.rejects(
    lifecycleRepositories.register({
      url: guidance.repository.url,
    }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed",
  );
  assert.equal(lifecycleRepositories.list()[0]?.lifecycle, "retired");
  renameSync(
    join(directory, "populated-unavailable.git"),
    join(directory, "populated.git"),
  );
  const reactivated = await lifecycleRepositories.register({
    url: guidance.repository.url,
  });
  assert.equal(reactivated.id, "repository-lifecycle");
  assert.equal(reactivated.lifecycle, "enabled");
  assert.equal(lifecycleRepositories.list().length, 1);
  await assert.rejects(
    lifecycleRepositories.register({ url: guidance.repository.url }),
    {
      code: "repository_identity_conflict",
      message: "Repository identity is already registered",
    },
  );
  lifecycleRepositories.destroy();
  lifecycleCore.close();
}
