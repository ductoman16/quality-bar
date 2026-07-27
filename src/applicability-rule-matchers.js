import { RE2 } from "re2-wasm";

import { failApplicabilityRule } from "./applicability-rule-error.js";

/** @param {string} glob */
export function compileGitGlob(glob) {
  const prefix = ":(glob)";
  if (
    !glob.startsWith(prefix) ||
    glob.length === prefix.length ||
    glob.startsWith(prefix + "/") ||
    glob.includes("\\") ||
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
  for (
    let index = pattern.indexOf("**");
    index !== -1;
    index = pattern.indexOf("**", index + 2)
  ) {
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
  }
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing === -1 || closing === index + 1) {
        failApplicabilityRule(
          "review_applicability_rule_git_glob_invalid",
          "Applicability Rule contains an invalid Git glob",
        );
      }
      const content = pattern.slice(index + 1, closing);
      const negated = content.startsWith("!");
      const members = (negated ? content.slice(1) : content).replace(
        /[\\\]]/g,
        "\\$&",
      );
      if (members.length === 0) {
        failApplicabilityRule(
          "review_applicability_rule_git_glob_invalid",
          "Applicability Rule contains an invalid Git glob",
        );
      }
      expression += `[${negated ? "^" : ""}${members}]`;
      index = closing;
      continue;
    }
    expression += /[\\^$.*+?()[\]{}|]/.test(character)
      ? `\\${character}`
      : character;
  }
  try {
    return new RegExp(expression + "$", "u");
  } catch {
    failApplicabilityRule(
      "review_applicability_rule_git_glob_invalid",
      "Applicability Rule contains an invalid Git glob",
    );
  }
}

/** @param {string} pattern */
export function compileRe2(pattern) {
  try {
    return new RE2(pattern, "u");
  } catch {
    failApplicabilityRule(
      "review_applicability_rule_re2_invalid",
      "Applicability Rule contains an invalid RE2 content pattern",
    );
  }
}
