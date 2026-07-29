import {
  APPLICABILITY_RULE_PROFILE,
  compileApplicabilityRule,
} from "./applicability-rule.js";
import {
  appendBranch,
  combined,
  orderedIds,
  trace,
  unique,
} from "./applicability-evidence.js";

export { APPLICABILITY_RULE_PROFILE };
const OUTSIDE = "outside";

/** @param {any} expression */
function identify(expression) {
  const branches = new WeakMap();
  const predicates = new WeakMap();
  let branch = 0;
  let predicate = 0;
  /** @param {any} node */
  function visit(node) {
    if (
      ["and", "or", "not", "group", "file_exists", "path_exists"].includes(
        node.type,
      )
    ) {
      branches.set(node, `branch-${++branch}`);
    }
    if (
      ["literal", "file_fact", "match", "file_exists", "path_exists"].includes(
        node.type,
      )
    ) {
      predicates.set(node, `predicate-${++predicate}`);
    }
    for (const child of [
      node.left,
      node.right,
      node.operand,
      node.expression,
      node.predicate,
    ]) {
      if (child) {
        visit(child);
      }
    }
  }
  visit(expression);
  return { branches, predicates };
}

/** @param {any} value */
function validFileChange(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    (value.before_path === null || typeof value.before_path === "string") &&
    (value.after_path === null || typeof value.after_path === "string") &&
    ["added", "deleted", "modified", "renamed"].every(
      (field) => typeof value[field] === "boolean",
    )
  );
}

/**
 * @param {any} node
 * @param {{
 *   branches: WeakMap<object, string>,
 *   predicates: WeakMap<object, string>,
 *   fileChanges: any[] | undefined,
 *   file?: any,
 *   matchesPath: (pathspec: string, path: string) => boolean,
 *   path?: {side: "before" | "after", value: string}
 * }} context
 * @returns {any}
 */
function evaluate(node, context) {
  const branchId = context.branches.get(node);
  const predicateId = context.predicates.get(node);
  if (node.type === "literal") {
    return trace(node.value, {
      predicateIds: [predicateId],
    });
  }
  if (node.type === "group") {
    const result = evaluate(node.expression, context);
    if (result.state === true && branchId) {
      result.branchIds = unique([...result.branchIds, branchId]);
      result.matches = appendBranch(result.matches, branchId);
    }
    return result;
  }
  if (node.type === "not") {
    const result = evaluate(node.operand, context);
    if (result.state === "error" || result.state === OUTSIDE) {
      return result;
    }
    return trace(!result.state, {
      branchIds:
        !result.state && branchId
          ? unique([...result.branchIds, branchId])
          : result.branchIds,
      matches: appendBranch(
        result.matches,
        !result.state ? branchId : undefined,
      ),
      predicateIds: result.predicateIds,
    });
  }
  if (node.type === "and") {
    const left = evaluate(node.left, context);
    if (left.state === "error" || left.state === false) {
      return left;
    }
    if (left.state === OUTSIDE) {
      return left;
    }
    const right = evaluate(node.right, context);
    if (right.state === "error") {
      return right;
    }
    return combined(
      right.state === true ? true : right.state,
      left,
      right,
      branchId,
    );
  }
  if (node.type === "or") {
    const left = evaluate(node.left, context);
    if (left.state === "error" || left.state === true) {
      return left;
    }
    const right = evaluate(node.right, context);
    if (right.state === "error") {
      return right;
    }
    if (right.state === true) {
      return combined(true, trace(false), right, branchId);
    }
    return combined(
      left.state === OUTSIDE || right.state === OUTSIDE ? OUTSIDE : false,
      left,
      right,
      branchId,
    );
  }
  if (node.type === "file_exists") {
    if (!context.fileChanges) {
      return {
        ...trace("error"),
        error: {
          code: "applicability_file_changes_unavailable",
          detail:
            "Frozen File Changes are unavailable for Applicability evaluation",
          predicate_id: /** @type {string} */ (predicateId),
        },
      };
    }
    const matches = [];
    for (const file of context.fileChanges) {
      const result = evaluate(node.predicate, { ...context, file });
      if (result.state === "error") {
        return result;
      }
      if (result.state === true) {
        const sides = unique(
          result.matches.flatMap(
            /** @param {{sides: string[]}} match */ (match) => match.sides,
          ),
        );
        matches.push({
          after_path: file.after_path,
          before_path: file.before_path,
          branch_ids: orderedIds([
            ...(branchId ? [branchId] : []),
            ...result.branchIds,
          ]),
          file_change_id: file.id,
          predicate_ids: orderedIds([
            ...(predicateId ? [predicateId] : []),
            ...result.predicateIds,
          ]),
          sides: sides.length ? sides : ["change"],
        });
      }
    }
    return trace(matches.length > 0, {
      branchIds: matches.length > 0 && branchId ? [branchId] : [],
      matches,
      predicateIds: matches.length > 0 && predicateId ? [predicateId] : [],
    });
  }
  if (node.type === "path_exists") {
    const paths = [
      ["before", context.file?.before_path],
      ["after", context.file?.after_path],
    ].filter((entry) => typeof entry[1] === "string");
    const results = paths.map(([side, value]) =>
      evaluate(node.predicate, {
        ...context,
        path: {
          side: /** @type {"before" | "after"} */ (side),
          value,
        },
      }),
    );
    const failure = results.find((result) => result.state === "error");
    if (failure) {
      return failure;
    }
    const matched = results.filter((result) => result.state === true);
    return trace(matched.length > 0, {
      branchIds:
        matched.length > 0 && branchId
          ? unique([branchId, ...matched.flatMap((result) => result.branchIds)])
          : [],
      matches: matched.flatMap((result) => result.matches),
      predicateIds:
        matched.length > 0
          ? unique([
              ...(predicateId ? [predicateId] : []),
              ...matched.flatMap((result) => result.predicateIds),
            ])
          : [],
    });
  }
  if (node.type === "file_fact") {
    const matched = context.file?.[node.field] === true;
    return trace(matched, {
      matches: matched ? [{ sides: ["change"] }] : [],
      predicateIds: [predicateId],
    });
  }
  if (node.type === "match") {
    let side;
    let value;
    if (node.member === "path") {
      side = context.path?.side;
      value = context.path?.value;
    } else if (node.member === "before_path") {
      side = "before";
      value = context.file?.before_path;
    } else if (node.member === "after_path") {
      side = "after";
      value = context.file?.after_path;
    } else {
      side = node.member.startsWith("before_") ? "before" : "after";
      const content = context.file?.[node.member];
      if (content?.state === "error") {
        if (
          typeof content.error?.code !== "string" ||
          typeof content.error?.detail !== "string"
        ) {
          throw new TypeError("Frozen File Change content error is invalid");
        }
        return {
          ...trace("error"),
          error: {
            code: content.error?.code,
            detail: content.error?.detail,
            file_change_id: context.file?.id,
            predicate_id: /** @type {string} */ (predicateId),
            side,
          },
        };
      }
      return {
        ...trace("error"),
        error: {
          code: "applicability_content_predicate_unsupported",
          detail:
            "Content predicates are not available in this evaluation slice",
          file_change_id: context.file?.id,
          predicate_id: /** @type {string} */ (predicateId),
          side,
        },
      };
    }
    if (typeof value !== "string") {
      return trace(false);
    }
    let matched;
    try {
      matched = node.member.endsWith("_content")
        ? node.matcher.test(value)
        : context.matchesPath(node.matcher.pathspec, value);
    } catch (cause) {
      const owned =
        cause instanceof Error &&
        "code" in cause &&
        typeof cause.code === "string" &&
        /^[a-z][a-z0-9_]*$/.test(cause.code);
      if (!owned) {
        throw cause;
      }
      return {
        ...trace("error"),
        error: {
          code: cause.code,
          detail:
            cause.message.trim().length > 0
              ? cause.message
              : "Applicability predicate evaluation failed",
          file_change_id: context.file?.id,
          predicate_id: /** @type {string} */ (predicateId),
          side,
        },
      };
    }
    return trace(matched, {
      matches: matched ? [{ sides: [side] }] : [],
      predicateIds: [predicateId],
    });
  }
  throw new TypeError("Compiled Applicability Rule is invalid");
}

/**
 * @param {string} source
 * @param {{file_changes?: unknown, base_commit?: string, head_commit?: string}} changeset
 * @param {{matchesPath: (pathspec: string, path: string) => boolean}} options
 */
export function evaluateApplicabilityRule(source, changeset, { matchesPath }) {
  if (typeof matchesPath !== "function") {
    throw new TypeError("Applicability path matcher is invalid");
  }
  const compiled = compileApplicabilityRule(source);
  const fileChanges = Array.isArray(changeset?.file_changes)
    ? changeset.file_changes
    : undefined;
  if (fileChanges && !fileChanges.every(validFileChange)) {
    const invalid = fileChanges.find(
      (fileChange) => !validFileChange(fileChange),
    );
    return {
      error: {
        code: "applicability_file_change_invalid",
        detail: `Frozen File Change ${
          typeof invalid?.id === "string" ? invalid.id : "identity"
        } is invalid`,
      },
      outcome: "error",
      profile: APPLICABILITY_RULE_PROFILE,
      source,
    };
  }
  const identified = identify(compiled.expression);
  const result = evaluate(compiled.expression, {
    ...identified,
    fileChanges: fileChanges?.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    matchesPath,
  });
  if (result.state === "error") {
    return {
      error: result.error,
      outcome: "error",
      profile: APPLICABILITY_RULE_PROFILE,
      source,
    };
  }
  if (result.state === true) {
    return {
      evidence:
        result.matches.length === 0
          ? {
              branch_ids: result.branchIds,
              kind: "satisfied_branches",
              predicate_ids: result.predicateIds,
            }
          : {
              kind: "matched",
              matches: result.matches,
            },
      outcome: "applicable",
      profile: APPLICABILITY_RULE_PROFILE,
      source,
    };
  }
  return {
    evidence: {
      branch_ids: [identified.branches.get(compiled.expression)].filter(
        Boolean,
      ),
      kind: "failed_branches",
      predicate_ids: [identified.predicates.get(compiled.expression)].filter(
        Boolean,
      ),
    },
    outcome: "not_applicable",
    profile: APPLICABILITY_RULE_PROFILE,
    source,
  };
}
