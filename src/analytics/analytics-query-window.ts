export function analyticsEventWindow(
  column: string,
  filters: Record<string, unknown>,
) {
  const clauses = [];
  const parameters = [];
  if (filters.start !== undefined) {
    clauses.push(`${column} >= ?`);
    parameters.push(filters.start as number);
  }
  if (filters.end !== undefined) {
    clauses.push(`${column} < ?`);
    parameters.push(filters.end as number);
  }
  return {
    sql: clauses.length === 0 ? "1 = 1" : clauses.join(" AND "),
    parameters,
  };
}

export function analyticsWaiverFilters(filters: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([name]) => !["start", "end"].includes(name),
    ),
  );
}
