import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPLICABILITY_RULE_PROFILE,
  ApplicabilityRuleError,
  compileApplicabilityRule,
} from "../src/applicability/applicability-rule.js";

test("the restricted CEL profile compiles its complete Boolean and File Change surface", () => {
  for (const source of [
    "true",
    "!false",
    "file_changes.exists(file, file.added)",
    'file_changes.exists(file, file.renamed && file.paths.exists(path, path.matches(":(glob)src/**")))',
    'file_changes.exists(file, file.before_path.matches(":(glob)src/**/*.js") && file.after_path.matches(":(glob)lib/**/*.js"))',
    'file_changes.exists(file, file.after_path.matches(":(glob)**/README.md"))',
    'file_changes.exists(file, file.after_path.matches(":(glob)src/api\\\\-route.js"))',
    'file_changes.exists(file, file.after_path.matches(":(glob)src[/]api-route.js"))',
    'file_changes.exists(file, file.before_content.matches("(?i)deprecated") || file.after_content.matches("^export "))',
    "(file_changes.exists(file, file.modified) && file_changes.exists(file, file.deleted)) || false",
  ]) {
    const compiled = compileApplicabilityRule(source);
    assert.equal(compiled.profile, APPLICABILITY_RULE_PROFILE);
    assert.equal(compiled.source, source);
  }
});

test("the restricted CEL compiler preserves exact Git pathspec and produces a native RE2 matcher", () => {
  const pathProgram = compileApplicabilityRule(
    'file_changes.exists(file, file.after_path.matches(":(glob)src/**/*.js"))',
  );
  assert.deepEqual(pathProgram.expression.predicate.matcher, {
    pathspec: ":(glob)src/**/*.js",
  });
  const escapedPathProgram = compileApplicabilityRule(
    'file_changes.exists(file, file.after_path.matches(":(glob)src/api\\\\-route.js"))',
  );
  assert.deepEqual(escapedPathProgram.expression.predicate.matcher, {
    pathspec: ":(glob)src/api\\-route.js",
  });
  const contentProgram = compileApplicabilityRule(
    'file_changes.exists(file, file.after_content.matches("(?i)^export "))',
  );
  assert.equal(
    contentProgram.expression.predicate.matcher.test("EXPORT function"),
    true,
  );
});

test("the restricted CEL profile rejects every unowned CEL feature and ambiguous Boolean composition", () => {
  for (const [source, code] of [
    ["", "review_applicability_rule_parse_invalid"],
    ["file_changes.size() > 0", "review_applicability_rule_unsupported"],
    [
      "file_changes.exists(file, file.added) && true || false",
      "review_applicability_rule_parentheses_required",
    ],
    [
      'file_changes.exists(file, file.after_path.matches("*.js"))',
      "review_applicability_rule_git_glob_invalid",
    ],
    [
      'file_changes.exists(file, file.after_path.matches(":(glob)src/**test.js"))',
      "review_applicability_rule_git_glob_invalid",
    ],
    [
      'file_changes.exists(file, file.after_path.matches(":(glob,exclude)src/**"))',
      "review_applicability_rule_git_glob_invalid",
    ],
    [
      'file_changes.exists(file, file.after_content.matches("(?=unsafe)"))',
      "review_applicability_rule_re2_invalid",
    ],
    [
      'file_changes.exists(file, file.after_content.matches("\\\\cA"))',
      "review_applicability_rule_re2_invalid",
    ],
    [
      'file_changes.exists(file, file.after_content.matches("\\\\u0041"))',
      "review_applicability_rule_re2_invalid",
    ],
    [
      'file_changes.exists(file, "not Boolean")',
      "review_applicability_rule_type_invalid",
    ],
    [
      'file_changes.exists(file, file.added.matches("unsupported"))',
      "review_applicability_rule_type_invalid",
    ],
    [
      "file_changes.all(file, file.added)",
      "review_applicability_rule_unsupported",
    ],
    ["file_changes[0].added", "review_applicability_rule_unsupported"],
    ["true ? false : true", "review_applicability_rule_unsupported"],
  ]) {
    assert.throws(
      () => compileApplicabilityRule(source),
      (error) => error instanceof ApplicabilityRuleError && error.code === code,
      source,
    );
  }
});
