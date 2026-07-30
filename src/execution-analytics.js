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

const TOKEN_COUNTER_NAMES = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
];

/** @param {number} numerator @param {number} denominator */
function rate(numerator, denominator) {
  return { denominator, numerator };
}

/** @param {number[]} values */
function summary(values) {
  if (values.length === 0) {
    return { execution_count: 0, median_ms: null, total_ms: null };
  }
  const sorted = values.toSorted((left, right) => left - right);
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
  }
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : sorted[middle - 1] / 2 + sorted[middle] / 2;
  return {
    execution_count: values.length,
    median_ms: median,
    total_ms: total,
  };
}

/** @param {number[]} values @param {number} population */
function tokenSummary(values, population) {
  if (values.length === 0) {
    return {
      coverage: rate(0, population),
      median: null,
      sum: null,
    };
  }
  const sorted = values.toSorted((left, right) => left - right);
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isSafeInteger(sum)) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
  }
  const middle = Math.floor(sorted.length / 2);
  return {
    coverage: rate(values.length, population),
    median:
      sorted.length % 2 === 1
        ? sorted[middle]
        : sorted[middle - 1] / 2 + sorted[middle] / 2,
    sum,
  };
}

/**
 * @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows
 * @param {Record<string, string>} terminalOutcomes
 */
export function deriveExecutionReliability(rows, terminalOutcomes) {
  const outcomeNames = Object.values(terminalOutcomes);
  const durations = /** @type {Record<string, number[]>} */ (
    Object.fromEntries(
      ["terminal", ...outcomeNames].map((outcome) => [outcome, []]),
    )
  );
  const counterValues = /** @type {Record<string, number[]>} */ (
    Object.fromEntries(TOKEN_COUNTER_NAMES.map((name) => [name, []]))
  );
  const outcomeCounts = /** @type {Record<string, number>} */ (
    Object.fromEntries(outcomeNames.map((outcome) => [outcome, 0]))
  );
  /** @type {Map<string, number>} */
  const failureCodes = new Map();
  let active = 0;
  let terminalStarted = 0;
  for (const row of rows) {
    const status = row?.execution_status;
    const startedAt = row?.started_at;
    const completedAt = row?.completed_at;
    const errorCode = row?.error_code;
    const timestampsValid =
      (startedAt === null ||
        (typeof startedAt === "number" &&
          Number.isSafeInteger(startedAt) &&
          startedAt >= 0)) &&
      (completedAt === null ||
        (typeof completedAt === "number" &&
          Number.isSafeInteger(completedAt) &&
          completedAt >= 0));
    const countersValid = TOKEN_COUNTER_NAMES.every((name) => {
      const value = row?.[name];
      return (
        value === null ||
        (Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0)
      );
    });
    const stateValid =
      (status === "queued" && startedAt === null && completedAt === null) ||
      (status === "running" &&
        typeof startedAt === "number" &&
        completedAt === null) ||
      (["completed", "failed"].includes(/** @type {string} */ (status)) &&
        typeof startedAt === "number" &&
        typeof completedAt === "number") ||
      (status === "cancelled" &&
        ((startedAt === null && completedAt === null) ||
          (typeof startedAt === "number" && typeof completedAt === "number")));
    const failureValid =
      (status === "failed" &&
        typeof errorCode === "string" &&
        /^[a-z][a-z0-9_]*$/.test(errorCode)) ||
      (status !== "failed" && errorCode === null);
    if (
      !timestampsValid ||
      !countersValid ||
      !stateValid ||
      !failureValid ||
      (typeof startedAt === "number" &&
        typeof completedAt === "number" &&
        completedAt < startedAt)
    ) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    if (status === "queued" || status === "running") {
      active += 1;
      continue;
    }
    if (startedAt === null || completedAt === null) {
      continue;
    }
    const outcome = terminalOutcomes[/** @type {string} */ (status)];
    if (typeof outcome !== "string") {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    const duration = completedAt - startedAt;
    durations.terminal.push(duration);
    durations[outcome].push(duration);
    outcomeCounts[outcome] += 1;
    terminalStarted += 1;
    if (status === "failed") {
      failureCodes.set(
        /** @type {string} */ (errorCode),
        (failureCodes.get(/** @type {string} */ (errorCode)) ?? 0) + 1,
      );
    }
    for (const name of TOKEN_COUNTER_NAMES) {
      const value = row?.[name];
      if (typeof value === "number") {
        counterValues[name].push(value);
      }
    }
  }
  return {
    active,
    duration: Object.fromEntries(
      Object.entries(durations).map(([outcome, values]) => [
        outcome,
        summary(values),
      ]),
    ),
    ...Object.fromEntries(
      outcomeNames.flatMap((outcome) => [
        [outcome, outcomeCounts[outcome]],
        [`${outcome}_rate`, rate(outcomeCounts[outcome], terminalStarted)],
      ]),
    ),
    failure_codes: [...failureCodes]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, count]) => ({ code, count })),
    token_counters: Object.fromEntries(
      TOKEN_COUNTER_NAMES.map((name) => [
        name,
        tokenSummary(counterValues[name], terminalStarted),
      ]),
    ),
  };
}
