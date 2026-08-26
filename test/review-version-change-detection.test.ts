import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createReviewService } from "../src/review/review.ts";

test("changing only the Applicability Rule or Codex configuration creates the next version", () => {
  const isolatedChanges: Array<
    [
      string,
      (
        snapshot: ReturnType<typeof snapshotFor>,
      ) => ReturnType<typeof snapshotFor>,
    ]
  > = [
    [
      "Applicability Rule",
      (snapshot) => ({ ...snapshot, applicability_rule: "true" }),
    ],
    [
      "Codex configuration",
      (snapshot) => ({
        ...snapshot,
        codex_configuration: {
          model: "gpt-5.6-sol",
          reasoning_effort: "xhigh",
          service_tier: "fast",
        },
      }),
    ],
  ];
  for (const [label, change] of isolatedChanges) {
    const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-change-"));
    try {
      const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
      const reviews = createReviewService(core);
      const created = reviews.create(reviewDefinition(label));
      const saved = reviews.saveVersion(
        created.id,
        change(snapshotFor(created)),
      );

      assert.equal(saved.changed, true, label);
      assert.equal(saved.review.active_version.number, 2, label);
      core.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

function reviewDefinition(name: string) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Keep this exact." }],
    description: "Detect executable changes.",
    name,
  };
}

function snapshotFor(review: {
  active_version: {
    codex_configuration: {
      model: string;
      reasoning_effort: string;
      service_tier: string;
    };
    criteria: Array<{ id: string; impact: string; instruction: string }>;
  };
}) {
  return {
    applicability_rule: null as string | null,
    codex_configuration: review.active_version.codex_configuration,
    criteria: review.active_version.criteria.map(
      ({ id, impact, instruction }) => ({ id, impact, instruction }),
    ),
  };
}
