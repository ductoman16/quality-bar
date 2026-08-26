import re2Wasm from "re2-wasm/build/wasm/re2.js";

import { failApplicabilityRule } from "./applicability-rule-error.ts";

const { WrappedRE2 } = re2Wasm;

function escaped(pattern: string, index: number) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && pattern[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function compileGitGlob(glob: string) {
  const prefix = ":(glob)";
  if (
    !glob.startsWith(prefix) ||
    glob.length === prefix.length ||
    glob.startsWith(prefix + "/") ||
    glob.includes("\0") ||
    glob
      .slice(prefix.length)
      .split("/")
      .some((part) => part === "..")
  ) {
    failApplicabilityRule(
      "review_applicability_rule_git_glob_invalid",
      "Applicability Rule path match must contain one positive Repository-root-relative Git :(glob) pattern",
    );
  }
  const pattern = glob.slice(prefix.length);
  for (let index = 0; index < pattern.length - 1; index += 1) {
    if (
      pattern[index] !== "*" ||
      pattern[index + 1] !== "*" ||
      escaped(pattern, index) ||
      escaped(pattern, index + 1)
    ) {
      continue;
    }
    const before = pattern[index - 1];
    const after = pattern[index + 2];
    const valid =
      (index === 0 && after === "/") ||
      (before === "/" && (after === "/" || after === undefined));
    if (!valid || pattern[index + 2] === "*") {
      failApplicabilityRule(
        "review_applicability_rule_git_glob_invalid",
        "Applicability Rule contains an invalid Git glob",
      );
    }
    index += 1;
  }
  return Object.freeze({ pathspec: glob });
}

class NativeRe2Matcher {
  compiled: any;

  constructor(pattern: string) {
    this.compiled = new WrappedRE2(pattern, false, false, false);
    if (!this.compiled.ok()) {
      failApplicabilityRule(
        "review_applicability_rule_re2_invalid",
        "Applicability Rule contains an invalid RE2 content pattern",
      );
    }
  }

  test(value: string) {
    return this.compiled.match(value, 0, false).index >= 0;
  }
}

export function compileRe2(pattern: string) {
  return new NativeRe2Matcher(pattern);
}
