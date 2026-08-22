/** @param {string[]} values */
export function unique(values) {
  return [...new Set(values)];
}

/** @param {string[]} values */
export function orderedIds(values) {
  return unique(values).toSorted(
    (left, right) =>
      Number(left.slice(left.lastIndexOf("-") + 1)) -
      Number(right.slice(right.lastIndexOf("-") + 1)),
  );
}

/** @param {any[]} matches @param {string | undefined} branchId */
export function appendBranch(matches, branchId) {
  if (!branchId) {
    return matches;
  }
  return matches.map((match) =>
    Array.isArray(match.branch_ids)
      ? {
          ...match,
          branch_ids: orderedIds([...match.branch_ids, branchId]),
        }
      : match,
  );
}

/** @param {any} state @param {any} [additions] @returns {any} */
export function trace(state, additions = {}) {
  return {
    branchIds: additions.branchIds ?? [],
    matches: additions.matches ?? [],
    predicateIds: additions.predicateIds ?? [],
    state,
  };
}

/** @param {any} state @param {any} left @param {any} right @param {string | undefined} branchId */
export function combined(state, left, right, branchId) {
  return trace(state, {
    branchIds: unique([
      ...left.branchIds,
      ...right.branchIds,
      ...(state === true && branchId ? [branchId] : []),
    ]),
    matches: appendBranch(
      [...left.matches, ...right.matches],
      state === true ? branchId : undefined,
    ),
    predicateIds: unique([...left.predicateIds, ...right.predicateIds]),
  });
}
