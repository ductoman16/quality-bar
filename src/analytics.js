export class AnalyticsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "AnalyticsError";
    this.code = code;
  }
}

/** @param {number} numerator @param {number} denominator */
function rate(numerator, denominator) {
  return { denominator, numerator };
}

/**
 * @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows
 * @param {string} identity
 * @param {string[]} outcomes
 */
function countOutcomes(rows, identity, outcomes) {
  /** @type {Map<string, Record<string, number>>} */
  const counts = new Map();
  for (const row of rows) {
    const id = row?.[identity];
    const outcome = row?.outcome;
    if (typeof id !== "string" || !outcomes.includes(String(outcome))) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    const population =
      counts.get(id) ?? Object.fromEntries(outcomes.map((name) => [name, 0]));
    population[String(outcome)] += 1;
    counts.set(id, population);
  }
  return counts;
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>
 * }} durableCore
 */
export function createAnalyticsService(durableCore) {
  if (typeof durableCore?.all !== "function") {
    throw new TypeError("Analytics durable core is required");
  }
  return {
    read() {
      try {
        const applicabilityRows = durableCore.all(
          `SELECT review_id, outcome
             FROM applicability_results
            ORDER BY review_id, rowid`,
        );
        const criterionRows = durableCore.all(
          `SELECT criterion_id, outcome
             FROM criterion_results
            ORDER BY criterion_id, rowid`,
        );
        const applicability = countOutcomes(applicabilityRows, "review_id", [
          "applicable",
          "not_applicable",
          "error",
        ]);
        const criteria = countOutcomes(criterionRows, "criterion_id", [
          "clear",
          "triggered",
          "not_applicable",
          "error",
        ]);
        return {
          criterion_outcomes: [...criteria].map(([criterionId, counts]) => {
            const judged = counts.triggered + counts.clear;
            const total = judged + counts.not_applicable + counts.error;
            return {
              clear: counts.clear,
              clear_rate: rate(counts.clear, judged),
              criterion_id: criterionId,
              error: counts.error,
              error_rate: rate(counts.error, total),
              not_applicable: counts.not_applicable,
              not_applicable_rate: rate(counts.not_applicable, total),
              trigger_rate: rate(counts.triggered, judged),
              triggered: counts.triggered,
            };
          }),
          review_applicability: [...applicability].map(([reviewId, counts]) => {
            const judged = counts.applicable + counts.not_applicable;
            const total = judged + counts.error;
            return {
              applicable: counts.applicable,
              applicability_rate: rate(counts.applicable, judged),
              error: counts.error,
              error_rate: rate(counts.error, total),
              not_applicable: counts.not_applicable,
              review_id: reviewId,
            };
          }),
        };
      } catch (cause) {
        if (cause instanceof AnalyticsError) {
          throw cause;
        }
        throw new AnalyticsError(
          "analytics_query_failed",
          "Analytics query failed",
          { cause },
        );
      }
    },
  };
}
