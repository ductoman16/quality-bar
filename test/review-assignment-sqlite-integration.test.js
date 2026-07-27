import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewService, ReviewError } from "../src/review.js";

/** @param {string} name */
function reviewDefinition(name) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Keep Repository scope on the Assignment.",
      },
    ],
    description: "Prove exact additive Review selection.",
    name,
  };
}

/**
 * @param {ReturnType<typeof openDurableCore>} core
 * @param {string} id
 * @param {number} createdAt
 */
function insertRepository(core, id, createdAt) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    id,
    `https://example.com/${id}.git`,
    createdAt,
    createdAt,
  );
}

test("changing a Review Assignment is atomic and composes matching Reviews additively", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-assignment-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    insertRepository(core, "repository-1", 1);
    insertRepository(core, "repository-2", 2);
    const reviews = createReviewService(core, {
      createId: (() => {
        let next = 0;
        return () => `assignment-fact-${++next}`;
      })(),
      now: () => 10,
    });
    const installationWide = reviews.create(
      reviewDefinition("Installation-wide"),
    );
    const repositorySpecific = reviews.create(
      reviewDefinition("Repository-specific"),
    );
    const otherRepository = reviews.create(
      reviewDefinition("Other Repository"),
    );
    const executableFacts = core.all(
      "SELECT id, review_id, number, applicability_rule FROM review_versions ORDER BY id",
    );
    assert.throws(
      () =>
        core.run(
          "INSERT INTO review_assignment_repositories (review_id, repository_id) VALUES (?, ?)",
          installationWide.id,
          "repository-1",
        ),
      /review_assignment_scope_conflict/,
    );

    const changed = reviews.setAssignment(repositorySpecific.id, {
      repository_ids: ["repository-2", "repository-1"],
      scope: "repository_set",
    });
    reviews.setAssignment(otherRepository.id, {
      repository_ids: ["repository-2"],
      scope: "repository_set",
    });

    assert.equal(changed.changed, true);
    assert.deepEqual(changed.review.assignment, {
      repository_ids: ["repository-1", "repository-2"],
      scope: "repository_set",
    });
    assert.throws(
      () =>
        core.run(
          "UPDATE review_assignments SET scope = ? WHERE review_id = ?",
          "installation_wide",
          repositorySpecific.id,
        ),
      /review_assignment_scope_conflict/,
    );
    assert.deepEqual(
      reviews.selectForNewEvaluation("repository-1"),
      [installationWide, repositorySpecific].map((review) => ({
        review_id: review.id,
        review_version_id: review.active_version.id,
      })),
    );
    assert.throws(
      () => reviews.selectForNewEvaluation("repository-missing"),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_assignment_repository_not_found",
    );
    assert.deepEqual(
      core.all(
        "SELECT review_id, scope FROM review_assignments ORDER BY review_id",
      ),
      [
        {
          review_id: installationWide.id,
          scope: "installation_wide",
        },
        {
          review_id: repositorySpecific.id,
          scope: "repository_set",
        },
        {
          review_id: otherRepository.id,
          scope: "repository_set",
        },
      ],
    );
    assert.deepEqual(
      core.all(
        "SELECT review_id, repository_id FROM review_assignment_repositories ORDER BY review_id, repository_id",
      ),
      [
        {
          repository_id: "repository-1",
          review_id: repositorySpecific.id,
        },
        {
          repository_id: "repository-2",
          review_id: repositorySpecific.id,
        },
        {
          repository_id: "repository-2",
          review_id: otherRepository.id,
        },
      ],
    );
    assert.deepEqual(
      core.all(
        "SELECT id, review_id, number, applicability_rule FROM review_versions ORDER BY id",
      ),
      executableFacts,
    );

    assert.deepEqual(
      reviews.setAssignment(repositorySpecific.id, {
        repository_ids: ["repository-1", "repository-2"],
        scope: "repository_set",
      }),
      { changed: false, review: changed.review },
    );
    const beforeFailure = {
      assignment: core.all(
        "SELECT * FROM review_assignments WHERE review_id = ?",
        repositorySpecific.id,
      ),
      repositories: core.all(
        "SELECT * FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
        repositorySpecific.id,
      ),
    };
    assert.throws(
      () =>
        reviews.setAssignment(repositorySpecific.id, {
          repository_ids: ["repository-missing"],
          scope: "repository_set",
        }),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_assignment_repository_not_found",
    );
    assert.deepEqual(
      {
        assignment: core.all(
          "SELECT * FROM review_assignments WHERE review_id = ?",
          repositorySpecific.id,
        ),
        repositories: core.all(
          "SELECT * FROM review_assignment_repositories WHERE review_id = ? ORDER BY repository_id",
          repositorySpecific.id,
        ),
      },
      beforeFailure,
    );

    const installationResult = reviews.setAssignment(repositorySpecific.id, {
      scope: "installation_wide",
    });
    assert.equal(installationResult.changed, true);
    assert.deepEqual(installationResult.review.assignment, {
      scope: "installation_wide",
    });
    assert.deepEqual(
      core.all(
        "SELECT * FROM review_assignment_repositories WHERE review_id = ?",
        repositorySpecific.id,
      ),
      [],
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
