export function unique(values: string[]) {
  return [...new Set(values)];
}

export function orderedIds(values: string[]) {
  return unique(values).toSorted(
    (left: any, right: any) =>
      Number(left.slice(left.lastIndexOf("-") + 1)) -
      Number(right.slice(right.lastIndexOf("-") + 1)),
  );
}

export function appendBranch(matches: any[], branchId: string | undefined) {
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

export function trace(state: any, additions: any = {}): any {
  return {
    branchIds: additions.branchIds ?? [],
    matches: additions.matches ?? [],
    predicateIds: additions.predicateIds ?? [],
    state,
  };
}

export function combined(
  state: any,
  left: any,
  right: any,
  branchId: string | undefined,
) {
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
