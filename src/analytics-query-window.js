/**
 * @param {string} column
 * @param {Record<string, unknown>} filters
 */
export function analyticsEventWindow(column, filters) {
  const clauses = [];
  const parameters = [];
  if (filters.start !== undefined) {
    clauses.push(`${column} >= ?`);
    parameters.push(/** @type {number} */ (filters.start));
  }
  if (filters.end !== undefined) {
    clauses.push(`${column} < ?`);
    parameters.push(/** @type {number} */ (filters.end));
  }
  return {
    sql: clauses.length === 0 ? "1 = 1" : clauses.join(" AND "),
    parameters,
  };
}

/** @param {Record<string, unknown>} filters */
export function analyticsWaiverFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([name]) => !["start", "end"].includes(name),
    ),
  );
}
