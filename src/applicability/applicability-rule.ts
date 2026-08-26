import {
  ApplicabilityRuleError,
  failApplicabilityRule,
} from "./applicability-rule-error.ts";
import { compileGitGlob, compileRe2 } from "./applicability-rule-matchers.ts";

export const APPLICABILITY_RULE_PROFILE = "quality-bar-restricted-cel-v1";
export { ApplicabilityRuleError };
const fail = failApplicabilityRule;

function tokenize(source: string) {
  const tokens: Array<{ kind: string; value: string; position: number }> = [];
  let position = 0;
  while (position < source.length) {
    const character = source[position];
    if (/\s/.test(character)) {
      position += 1;
      continue;
    }
    const pair = source.slice(position, position + 2);
    if (pair === "&&" || pair === "||") {
      tokens.push({ kind: "operator", position, value: pair });
      position += 2;
      continue;
    }
    if ("!().,".includes(character)) {
      tokens.push({ kind: "punctuation", position, value: character });
      position += 1;
      continue;
    }
    if (character === '"') {
      const start = position;
      position += 1;
      let escaped = false;
      while (position < source.length) {
        const current = source[position];
        position += 1;
        if (!escaped && current === '"') {
          const encoded = source.slice(start, position);
          let value;
          try {
            value = JSON.parse(encoded);
          } catch {
            fail(
              "review_applicability_rule_parse_invalid",
              "Applicability Rule contains an invalid string literal",
            );
          }
          tokens.push({ kind: "string", position: start, value });
          escaped = false;
          break;
        }
        if (!escaped && (current === "\n" || current === "\r")) {
          fail(
            "review_applicability_rule_parse_invalid",
            "Applicability Rule contains an invalid string literal",
          );
        }
        if (current === "\\" && !escaped) {
          escaped = true;
        } else {
          escaped = false;
        }
      }
      if (tokens.at(-1)?.position !== start) {
        fail(
          "review_applicability_rule_parse_invalid",
          "Applicability Rule contains an unterminated string literal",
        );
      }
      continue;
    }
    const identifier = source.slice(position).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({
        kind: "identifier",
        position,
        value: identifier[0],
      });
      position += identifier[0].length;
      continue;
    }
    if (/[=<>+\-*/%[\]{}?:'0-9]/.test(character)) {
      fail(
        "review_applicability_rule_unsupported",
        "Applicability Rule uses a CEL feature outside the restricted profile",
      );
    }
    fail(
      "review_applicability_rule_parse_invalid",
      `Applicability Rule contains invalid syntax at character ${position + 1}`,
    );
  }
  tokens.push({ kind: "end", position: source.length, value: "" });
  return tokens;
}

class Parser {
  tokens: { kind: string; value: string; position: number }[];
  position: 0;

  constructor(tokens: ReturnType<typeof tokenize>) {
    this.tokens = tokens;
    this.position = 0;
  }

  current() {
    return this.tokens[this.position];
  }

  take(value: string) {
    if (this.current().value !== value) {
      fail(
        "review_applicability_rule_parse_invalid",
        `Applicability Rule expected ${value} at character ${this.current().position + 1}`,
      );
    }
    this.position += 1;
  }

  takeKind(kind: string) {
    const token = this.current();
    if (token.kind !== kind) {
      fail(
        "review_applicability_rule_parse_invalid",
        `Applicability Rule expected ${kind} at character ${token.position + 1}`,
      );
    }
    this.position += 1;
    return token.value;
  }

  expression(environment: Map<string, string>): any {
    return this.or(environment);
  }

  or(environment: Map<string, string>): any {
    let node: any = this.and(environment);
    while (this.current().value === "||") {
      this.position += 1;
      const right = this.and(environment);
      this.requireBoolean(node);
      this.requireBoolean(right);
      node = {
        left: node,
        parenthesized: false,
        right,
        type: "or",
      };
    }
    return node;
  }

  and(environment: Map<string, string>): any {
    let node: any = this.unary(environment);
    while (this.current().value === "&&") {
      this.position += 1;
      const right = this.unary(environment);
      this.requireBoolean(node);
      this.requireBoolean(right);
      node = {
        left: node,
        parenthesized: false,
        right,
        type: "and",
      };
    }
    return node;
  }

  unary(environment: Map<string, string>): any {
    if (this.current().value === "!") {
      this.position += 1;
      const operand = this.unary(environment);
      this.requireBoolean(operand);
      return { operand, type: "not" };
    }
    return this.primary(environment);
  }

  primary(environment: Map<string, string>): any {
    if (this.current().value === "(") {
      this.position += 1;
      const node: any = this.expression(environment);
      this.requireBoolean(node);
      this.take(")");
      return { expression: node, parenthesized: true, type: "group" };
    }
    if (this.current().kind === "string") {
      return { type: "string", value: this.takeKind("string") };
    }
    const name = this.takeKind("identifier");
    if (name === "true" || name === "false") {
      return { type: "literal", value: name === "true" };
    }
    const receiver = environment.get(name);
    if (!receiver) {
      fail(
        "review_applicability_rule_unsupported",
        `Applicability Rule identifier ${name} is outside the restricted profile`,
      );
    }
    this.take(".");
    const member = this.takeKind("identifier");
    if (receiver === "file_changes" && member === "exists") {
      return this.exists(environment, "file");
    }
    if (receiver === "file") {
      if (["added", "deleted", "modified", "renamed"].includes(member)) {
        if (this.current().value === ".") {
          return this.typeInvalid();
        }
        return { field: member, name, type: "file_fact" };
      }
      if (member === "paths") {
        this.take(".");
        if (this.takeKind("identifier") !== "exists") {
          return this.unsupported();
        }
        return this.exists(environment, "path");
      }
      if (
        [
          "before_path",
          "after_path",
          "before_content",
          "after_content",
        ].includes(member)
      ) {
        return this.match(name, member);
      }
    }
    if (receiver === "path" && member === "matches") {
      return this.match(name, "path", true);
    }
    return this.unsupported();
  }

  exists(environment: Map<string, string>, type: "file" | "path"): any {
    this.take("(");
    const binding = this.takeKind("identifier");
    this.take(",");
    const nested = new Map(environment);
    nested.set(binding, type);
    const predicate: any = this.expression(nested);
    this.requireBoolean(predicate);
    this.take(")");
    return { binding, predicate, type: `${type}_exists` };
  }

  match(name: string, member: string, direct: boolean = false) {
    if (!direct) {
      this.take(".");
      if (this.takeKind("identifier") !== "matches") {
        return this.unsupported();
      }
    }
    this.take("(");
    if (this.current().kind !== "string") {
      return this.typeInvalid();
    }
    const pattern = this.takeKind("string");
    this.take(")");
    const matcher =
      member === "path" || member.endsWith("_path")
        ? compileGitGlob(pattern)
        : compileRe2(pattern);
    return { matcher, member, name, pattern, type: "match" };
  }

  unsupported() {
    return fail(
      "review_applicability_rule_unsupported",
      "Applicability Rule uses a CEL feature outside the restricted profile",
    );
  }

  requireBoolean(node: any) {
    if (node.type === "string") {
      this.typeInvalid();
    }
  }

  typeInvalid() {
    return fail(
      "review_applicability_rule_type_invalid",
      "Applicability Rule must type-check as Boolean within the restricted profile",
    );
  }
}

function requireExplicitParentheses(node: any) {
  if (node.type === "and" || node.type === "or") {
    const opposite = node.type === "and" ? "or" : "and";
    for (const child of [node.left, node.right]) {
      if (child.type === opposite && child.parenthesized !== true) {
        fail(
          "review_applicability_rule_parentheses_required",
          "Applicability Rule must parenthesize every mixed && and || expression",
        );
      }
      requireExplicitParentheses(child);
    }
  } else if (node.type === "group") {
    requireExplicitParentheses(node.expression);
  } else if (node.type === "not") {
    requireExplicitParentheses(node.operand);
  } else if (node.type.endsWith("_exists")) {
    requireExplicitParentheses(node.predicate);
  }
}

function freeze(value: any) {
  if (
    value &&
    typeof value === "object" &&
    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)
  ) {
    for (const nested of Object.values(value)) {
      freeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export function compileApplicabilityRule(source: string) {
  if (typeof source !== "string" || source.trim().length === 0) {
    fail(
      "review_applicability_rule_parse_invalid",
      "Applicability Rule must be a nonblank CEL expression",
    );
  }
  const parser = new Parser(tokenize(source));
  const expression = parser.expression(
    new Map([["file_changes", "file_changes"]]),
  );
  parser.requireBoolean(expression);
  if (parser.current().kind !== "end") {
    fail(
      "review_applicability_rule_parse_invalid",
      `Applicability Rule contains unexpected syntax at character ${parser.current().position + 1}`,
    );
  }
  requireExplicitParentheses(expression);
  return freeze({
    expression,
    profile: APPLICABILITY_RULE_PROFILE,
    source,
  });
}
