import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createRepositoryGuidanceService } from "../src/repository/repository-guidance.js";
import { createReviewService, ReviewError } from "../src/review/review.js";

/** @param {string} name @param {"advisory" | "blocking"} impact */
function reviewDefinition(name, impact) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact,
        instruction: `Apply ${name} exactly.`,
      },
    ],
    description: `${name} description.`,
    name,
  };
}

test("SQLite returns one atomic Guidance document from registered Repository and current Review facts", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-guidance-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    core.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-1",
      "https://example.com/repository.git",
      1,
      1,
    );
    core.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-2",
      "https://example.com/other.git",
      2,
      2,
    );
    const reviews = createReviewService(core, {
      createId: (() => {
        let next = 0;
        return () => `guidance-fact-${++next}`;
      })(),
      now: () => 10,
    });
    const installationWide = reviews.create(
      reviewDefinition("Installation-wide", "blocking"),
    );
    const repositorySpecific = reviews.create(
      reviewDefinition("Repository-specific", "advisory"),
    );
    const otherRepository = reviews.create(
      reviewDefinition("Other Repository", "blocking"),
    );
    const archived = reviews.create(reviewDefinition("Archived", "advisory"));
    reviews.setAssignment(repositorySpecific.id, {
      repository_ids: ["repository-1"],
      scope: "repository_set",
    });
    reviews.setAssignment(otherRepository.id, {
      repository_ids: ["repository-2"],
      scope: "repository_set",
    });
    reviews.setArchived(archived.id, { archived: true });
    const guidance = createRepositoryGuidanceService(core);

    const first = guidance.read("repository-1");

    assert.deepEqual(
      first.reviews.map(({ id }) => id),
      [installationWide.id, repositorySpecific.id],
    );
    assert.deepEqual(
      first.reviews.map(({ assignment }) => assignment),
      [{ scope: "installation_wide" }, { scope: "repository_specific" }],
    );
    assert.deepEqual(first.repository, {
      id: "repository-1",
      url: "https://example.com/repository.git",
    });
    assert.deepEqual(
      guidance.read("repository-2").reviews.map(({ id }) => id),
      [installationWide.id, otherRepository.id],
    );

    const priorRevision = first.guidance_revision;
    reviews.updateMetadata(installationWide.id, {
      description: "Updated installation-wide description.",
      name: "Installation-wide updated",
    });
    const updated = guidance.read("repository-1");
    assert.notEqual(updated.guidance_revision, priorRevision);
    assert.equal(
      updated.reviews[0].description,
      "Updated installation-wide description.",
    );

    assert.deepEqual(
      guidance.read("repository-1"),
      guidance.read("repository-1"),
    );
    assert.throws(
      () => guidance.read("repository-missing"),
      (error) =>
        error instanceof ReviewError && error.code === "repository_not_found",
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite returns a valid empty Guidance document when no Review is assigned", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-guidance-empty-"));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  try {
    core.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      "repository-empty",
      "https://example.com/empty.git",
      1,
      1,
    );

    assert.deepEqual(
      createRepositoryGuidanceService(core).read("repository-empty").reviews,
      [],
    );
  } finally {
    core.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
