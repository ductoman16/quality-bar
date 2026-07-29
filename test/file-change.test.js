import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPLICABILITY_RULE_PROFILE,
  evaluateApplicabilityRule,
} from "../src/applicability-evaluation.js";
import { EvaluationError } from "../src/evaluation-validation.js";
import { legacyFileChangeModified } from "../src/evaluation-file-change-schema.js";
import { fileChangesFromGitNameStatus } from "../src/file-change.js";
import { createGitPathMatcher } from "../src/git-path-matcher.js";

/** @param {any} fileChange */
function evaluate(fileChange) {
  return evaluateApplicabilityRule(
    "file_changes.exists(file, true)",
    { file_changes: [fileChange] },
    {
      matchesPath() {
        throw new Error("File Change fact validation must not match a path");
      },
    },
  );
}

test("File Change kinds require their exact normalized before and after sides", () => {
  const validKinds = [
    {
      added: true,
      after_path: "src/added.js",
      before_path: null,
      deleted: false,
      id: "file-change-1",
      modified: false,
      renamed: false,
    },
    {
      added: false,
      after_path: null,
      before_path: "src/deleted.js",
      deleted: true,
      id: "file-change-2",
      modified: false,
      renamed: false,
    },
    {
      added: false,
      after_path: "src/modified.js",
      before_path: "src/modified.js",
      deleted: false,
      id: "file-change-3",
      modified: true,
      renamed: false,
    },
    {
      added: false,
      after_path: "src/renamed.js",
      before_path: "src/original.js",
      deleted: false,
      id: "file-change-4",
      modified: false,
      renamed: true,
    },
    {
      added: false,
      after_path: "src/current.js",
      before_path: "src/legacy.js",
      deleted: false,
      id: "file-change-5",
      modified: true,
      renamed: true,
    },
  ];
  for (const fileChange of validKinds) {
    assert.equal(evaluate(fileChange).outcome, "applicable");
  }

  for (const fileChange of [
    { ...validKinds[0], before_path: "src/added.js" },
    { ...validKinds[1], after_path: "src/deleted.js" },
    { ...validKinds[2], after_path: "src/other.js" },
    { ...validKinds[3], after_path: "src/original.js" },
    { ...validKinds[4], deleted: true },
    { ...validKinds[0], after_path: "/src/added.js" },
    { ...validKinds[0], after_path: "src//added.js" },
    { ...validKinds[0], after_path: "src/../added.js" },
    { ...validKinds[0], after_path: "src\\added.js" },
  ]) {
    assert.deepEqual(evaluate(fileChange), {
      error: {
        code: "applicability_file_change_invalid",
        detail: `Frozen File Change ${fileChange.id} is invalid`,
      },
      outcome: "error",
      profile: APPLICABILITY_RULE_PROFILE,
      source: "file_changes.exists(file, true)",
    });
  }
});

test("unsupported Git File Change states retain their exact owning error", () => {
  assert.throws(
    () => fileChangesFromGitNameStatus("T\0src/file.js\0"),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "evaluation_file_change_kind_unsupported" &&
      error.message === "Git File Change status T is unsupported",
  );
});

test("legacy rename migration requires exact Git similarity metadata", () => {
  assert.throws(
    () =>
      legacyFileChangeModified(
        "src/old.js",
        "src/new.js",
        "diff --git a/src/old.js b/src/new.js\n+similarity index 100%\n",
      ),
    /Legacy renamed File Change similarity metadata is invalid/,
  );
});

test("one authored Git pathspec expansion serves every touched path", () => {
  /** @type {{commit: string, pathspec: string}[]} */
  const calls = [];
  const matchesPath = createGitPathMatcher(
    ["base", "head"],
    (commit, pathspec) => {
      calls.push({ commit, pathspec });
      return commit === "base"
        ? ["src/deleted.js", "src/old.js"]
        : ["src/added.js", "src/new.js"];
    },
  );
  assert.deepEqual(
    [
      "src/deleted.js",
      "src/old.js",
      "src/added.js",
      "src/new.js",
      "src/missing.js",
    ].map((path) => matchesPath(":(glob)src/*.js", path)),
    [true, true, true, true, false],
  );
  assert.deepEqual(calls, [
    { commit: "base", pathspec: ":(glob)src/*.js" },
    { commit: "head", pathspec: ":(glob)src/*.js" },
  ]);
});
