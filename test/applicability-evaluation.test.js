import assert from "node:assert/strict";
import { test } from "node:test";
import AjvModule from "ajv";

import {
  APPLICABILITY_RULE_PROFILE,
  evaluateApplicabilityRule,
} from "../src/applicability/applicability-evaluation.js";
import { canonicalApplicabilitySchemas } from "../src/canonical/canonical-applicability-components.js";

const Ajv = AjvModule.default;
const validateApplicabilityResult = new Ajv({
  allowUnionTypes: true,
  strict: false,
}).compile(canonicalApplicabilitySchemas().ApplicabilityResult);

const changeset = {
  file_changes: [
    {
      added: false,
      after_content: { state: "text", value: "export const current = true;\n" },
      after_path: "src/current.js",
      before_content: { state: "text", value: "const current = false;\n" },
      before_path: "src/legacy.js",
      deleted: false,
      id: "file-change-2",
      modified: true,
      renamed: true,
    },
    {
      added: true,
      after_content: { state: "binary" },
      after_path: "assets/logo.bin",
      before_content: { state: "absent" },
      before_path: null,
      deleted: false,
      id: "file-change-1",
      modified: false,
      renamed: false,
    },
  ],
};

/** @param {string} pathspec @param {string} path */
function matchesPath(pathspec, path) {
  if (pathspec === ":(glob)src/**") {
    return path.startsWith("src/");
  }
  if (pathspec === ":(glob)docs/**") {
    return path.startsWith("docs/");
  }
  throw new Error(`unexpected pathspec ${pathspec}`);
}

test("restricted CEL evaluation selects once with deterministic match evidence", () => {
  const source =
    'file_changes.exists(file, file.renamed && file.paths.exists(path, path.matches(":(glob)src/**")))';
  assert.deepEqual(
    evaluateApplicabilityRule(source, changeset, { matchesPath }),
    {
      evidence: {
        kind: "matched",
        matches: [
          {
            after_path: "src/current.js",
            before_path: "src/legacy.js",
            branch_ids: ["branch-1", "branch-2", "branch-3"],
            file_change_id: "file-change-2",
            predicate_ids: [
              "predicate-1",
              "predicate-2",
              "predicate-3",
              "predicate-4",
            ],
            sides: ["change", "before", "after"],
          },
        ],
      },
      outcome: "applicable",
      profile: APPLICABILITY_RULE_PROFILE,
      source,
    },
  );
});

test("restricted CEL evaluation retains compact failed branches", () => {
  const source =
    'file_changes.exists(file, file.deleted || file.after_path.matches(":(glob)docs/**"))';
  assert.deepEqual(
    evaluateApplicabilityRule(source, changeset, { matchesPath }),
    {
      evidence: {
        branch_ids: ["branch-1"],
        kind: "failed_branches",
        predicate_ids: ["predicate-1"],
      },
      outcome: "not_applicable",
      profile: APPLICABILITY_RULE_PROFILE,
      source,
    },
  );
});

test("restricted CEL evaluation preserves exact side and predicate failure", () => {
  const source =
    'file_changes.exists(file, file.after_content.matches("unsafe"))';
  const result = evaluateApplicabilityRule(
    source,
    {
      file_changes: [
        {
          ...changeset.file_changes[0],
          after_content: {
            error: {
              code: "applicability_file_side_unreadable",
              detail: "The frozen head side could not be read.",
            },
            state: "error",
          },
        },
      ],
    },
    { matchesPath },
  );
  assert.deepEqual(result, {
    error: {
      code: "applicability_file_side_unreadable",
      detail: "The frozen head side could not be read.",
      file_change_id: "file-change-2",
      predicate_id: "predicate-2",
      side: "after",
    },
    outcome: "error",
    profile: APPLICABILITY_RULE_PROFILE,
    source,
  });
});

test("negated and file-wide matches retain canonical evidence", () => {
  const negated = evaluateApplicabilityRule("!false", changeset, {
    matchesPath,
  });
  assert.deepEqual(negated, {
    evidence: {
      branch_ids: ["branch-1"],
      kind: "satisfied_branches",
      predicate_ids: ["predicate-1"],
    },
    outcome: "applicable",
    profile: APPLICABILITY_RULE_PROFILE,
    source: "!false",
  });
  const negatedFileFact = evaluateApplicabilityRule(
    "file_changes.exists(file, !file.deleted)",
    { file_changes: [changeset.file_changes[0]] },
    { matchesPath },
  );
  assert.deepEqual(negatedFileFact.evidence, {
    kind: "matched",
    matches: [
      {
        after_path: "src/current.js",
        before_path: "src/legacy.js",
        branch_ids: ["branch-1", "branch-2"],
        file_change_id: "file-change-2",
        predicate_ids: ["predicate-1", "predicate-2"],
        sides: ["change"],
      },
    ],
  });
  const fileWide = evaluateApplicabilityRule(
    "file_changes.exists(file, true)",
    { file_changes: [changeset.file_changes[0]] },
    { matchesPath },
  );
  assert.deepEqual(fileWide.evidence, {
    kind: "matched",
    matches: [
      {
        after_path: "src/current.js",
        before_path: "src/legacy.js",
        branch_ids: ["branch-1"],
        file_change_id: "file-change-2",
        predicate_ids: ["predicate-1", "predicate-2"],
        sides: ["change"],
      },
    ],
  });
  for (const result of [negated, negatedFileFact, fileWide]) {
    assert.equal(
      validateApplicabilityResult({
        assignment: { scope: "installation_wide" },
        evidence: result.evidence,
        outcome: result.outcome,
        review_id: "review-1",
        review_version_id: "review-version-1",
        rule: { profile: result.profile, source: result.source },
      }),
      true,
      JSON.stringify(validateApplicabilityResult.errors),
    );
  }
});

test("Boolean composition retains only satisfied predicates and owning outer branches", () => {
  const disjunction = evaluateApplicabilityRule(
    "file_changes.exists(file, file.deleted || file.added)",
    changeset,
    { matchesPath },
  );
  assert.deepEqual(disjunction.evidence, {
    kind: "matched",
    matches: [
      {
        after_path: "assets/logo.bin",
        before_path: null,
        branch_ids: ["branch-1", "branch-2"],
        file_change_id: "file-change-1",
        predicate_ids: ["predicate-1", "predicate-3"],
        sides: ["change"],
      },
    ],
  });
  const conjunction = evaluateApplicabilityRule(
    "file_changes.exists(file, file.added) && file_changes.exists(file, file.renamed)",
    changeset,
    { matchesPath },
  );
  assert.deepEqual(conjunction.evidence, {
    kind: "matched",
    matches: [
      {
        after_path: "assets/logo.bin",
        before_path: null,
        branch_ids: ["branch-1", "branch-2"],
        file_change_id: "file-change-1",
        predicate_ids: ["predicate-1", "predicate-2"],
        sides: ["change"],
      },
      {
        after_path: "src/current.js",
        before_path: "src/legacy.js",
        branch_ids: ["branch-1", "branch-3"],
        file_change_id: "file-change-2",
        predicate_ids: ["predicate-3", "predicate-4"],
        sides: ["change"],
      },
    ],
  });
});

test("irrelevant Boolean branches do not require successor-owned content", () => {
  const unsupported =
    'file_changes.exists(file, file.after_content.matches("current"))';
  assert.deepEqual(
    evaluateApplicabilityRule(`true || ${unsupported}`, changeset, {
      matchesPath,
    }),
    {
      evidence: {
        branch_ids: [],
        kind: "satisfied_branches",
        predicate_ids: ["predicate-1"],
      },
      outcome: "applicable",
      profile: APPLICABILITY_RULE_PROFILE,
      source: `true || ${unsupported}`,
    },
  );
  assert.deepEqual(
    evaluateApplicabilityRule(`false && ${unsupported}`, changeset, {
      matchesPath,
    }),
    {
      evidence: {
        branch_ids: ["branch-1"],
        kind: "failed_branches",
        predicate_ids: [],
      },
      outcome: "not_applicable",
      profile: APPLICABILITY_RULE_PROFILE,
      source: `false && ${unsupported}`,
    },
  );
});

test("invalid File Change state fails explicitly", () => {
  const malformed = {
    ...changeset.file_changes[0],
    added: undefined,
  };
  assert.deepEqual(
    evaluateApplicabilityRule(
      "file_changes.exists(file, file.added)",
      { file_changes: [malformed] },
      { matchesPath },
    ),
    {
      error: {
        code: "applicability_file_change_invalid",
        detail: "Frozen File Change file-change-2 is invalid",
      },
      outcome: "error",
      profile: APPLICABILITY_RULE_PROFILE,
      source: "file_changes.exists(file, file.added)",
    },
  );
});

test("file-dependent rules fail exactly when the frozen File Change view is unavailable", () => {
  assert.deepEqual(
    evaluateApplicabilityRule(
      "file_changes.exists(file, file.added)",
      {},
      { matchesPath },
    ),
    {
      error: {
        code: "applicability_file_changes_unavailable",
        detail:
          "Frozen File Changes are unavailable for Applicability evaluation",
        predicate_id: "predicate-1",
      },
      outcome: "error",
      profile: APPLICABILITY_RULE_PROFILE,
      source: "file_changes.exists(file, file.added)",
    },
  );
  assert.deepEqual(evaluateApplicabilityRule("true", {}, { matchesPath }), {
    evidence: {
      branch_ids: [],
      kind: "satisfied_branches",
      predicate_ids: ["predicate-1"],
    },
    outcome: "applicable",
    profile: APPLICABILITY_RULE_PROFILE,
    source: "true",
  });
});

test("predicate dependency failure becomes exact Applicability error evidence", () => {
  const result = evaluateApplicabilityRule(
    'file_changes.exists(file, file.after_path.matches(":(glob)src/**"))',
    { file_changes: [changeset.file_changes[0]] },
    {
      matchesPath() {
        throw Object.assign(new Error("Git path matching could not run"), {
          code: "applicability_git_match_failed",
        });
      },
    },
  );
  assert.deepEqual(result, {
    error: {
      code: "applicability_git_match_failed",
      detail: "Git path matching could not run",
      file_change_id: "file-change-2",
      predicate_id: "predicate-2",
      side: "after",
    },
    outcome: "error",
    profile: APPLICABILITY_RULE_PROFILE,
    source:
      'file_changes.exists(file, file.after_path.matches(":(glob)src/**"))',
  });
});

test("unexpected predicate dependency failures remain hard failures", () => {
  const failure = new Error("Unexpected matcher failure");
  assert.throws(
    () =>
      evaluateApplicabilityRule(
        'file_changes.exists(file, file.after_path.matches(":(glob)src/**"))',
        { file_changes: [changeset.file_changes[0]] },
        {
          matchesPath() {
            throw failure;
          },
        },
      ),
    (error) => error === failure,
  );
});
