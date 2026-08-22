import assert from "node:assert/strict";
import { test } from "node:test";

import { APPLICABILITY_RULE_PROFILE } from "../src/applicability/applicability-rule.js";
import { buildRepositoryGuidance } from "../src/repository/repository-guidance.js";

test("Repository Guidance preserves the complete active Review contract without predicting applicability", () => {
  const repository = {
    id: "repository-1",
    url: "https://example.com/team/repository.git",
  };
  const reviews = [
    {
      active_version: {
        applicability_rule: null,
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          service_tier: "standard",
        },
        criteria: [
          {
            id: "criterion-2",
            impact: "blocking",
            instruction: "Preserve the public contract.",
            position: 1,
          },
          {
            id: "criterion-1",
            impact: "advisory",
            instruction: "Keep the implementation small.",
            position: 2,
          },
        ],
        id: "version-wide-2",
        number: 2,
      },
      archived: false,
      assignment: { scope: "installation_wide" },
      description: "Applies the shared standards.",
      id: "review-wide",
      name: "Shared standards",
      versions: [{ id: "historical-version" }],
    },
    {
      active_version: {
        applicability_rule:
          'file_changes.exists(file, file.paths.exists(path, path.matches("src/**")))',
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          service_tier: "standard",
        },
        criteria: [
          {
            id: "criterion-repository",
            impact: "advisory",
            instruction: "Keep source changes focused.",
            position: 1,
          },
        ],
        id: "version-repository-1",
        number: 1,
      },
      archived: false,
      assignment: {
        repository_ids: ["repository-1"],
        scope: "repository_set",
      },
      description: "Applies focused source guidance.",
      id: "review-repository",
      name: "Source guidance",
      versions: [],
    },
  ];

  const guidance = buildRepositoryGuidance(repository, reviews);

  assert.deepEqual(guidance, {
    guidance_revision: guidance.guidance_revision,
    repository: {
      id: "repository-1",
      url: "https://example.com/team/repository.git",
    },
    reviews: [
      {
        active_version: { id: "version-wide-2", number: 2 },
        applicability: { type: "unconditional" },
        assignment: { scope: "installation_wide" },
        criteria: [
          {
            id: "criterion-2",
            impact: "blocking",
            instruction: "Preserve the public contract.",
          },
          {
            id: "criterion-1",
            impact: "advisory",
            instruction: "Keep the implementation small.",
          },
        ],
        description: "Applies the shared standards.",
        id: "review-wide",
        name: "Shared standards",
      },
      {
        active_version: { id: "version-repository-1", number: 1 },
        applicability: {
          expression:
            'file_changes.exists(file, file.paths.exists(path, path.matches("src/**")))',
          profile: APPLICABILITY_RULE_PROFILE,
          type: "conditional",
        },
        assignment: { scope: "repository_specific" },
        criteria: [
          {
            id: "criterion-repository",
            impact: "advisory",
            instruction: "Keep source changes focused.",
          },
        ],
        description: "Applies focused source guidance.",
        id: "review-repository",
        name: "Source guidance",
      },
    ],
    schema_version: 1,
  });
  assert.match(guidance.guidance_revision, /^guidance-v1-[A-Za-z0-9_-]{43}$/);
  assert.equal(
    buildRepositoryGuidance(repository, reviews).guidance_revision,
    guidance.guidance_revision,
  );
  assert.doesNotMatch(
    JSON.stringify(guidance),
    /codex_configuration|historical-version|applicability_result/,
  );
});

test("Repository Guidance returns a valid versioned empty document", () => {
  const guidance = buildRepositoryGuidance(
    {
      id: "repository-empty",
      url: "https://example.com/empty.git",
    },
    [],
  );

  assert.deepEqual(guidance, {
    guidance_revision: guidance.guidance_revision,
    repository: {
      id: "repository-empty",
      url: "https://example.com/empty.git",
    },
    reviews: [],
    schema_version: 1,
  });
});
