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
export function nearestRankP95(values) {
  if (values.length === 0) {
    return null;
  }
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new AnalyticsError(
      "analytics_fact_invalid",
      "Canonical analytics fact is invalid",
    );
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

/**
 * @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows
 * @param {(row: Record<string, import("node:sqlite").SQLInputValue> | undefined) => string} outcome
 * @param {{end: number, start: number}} window
 */
export function deriveEvaluationOverview(rows, outcome, window) {
  let clearCount = 0;
  let terminalCount = 0;
  /** @type {number[]} */
  const durations = [];
  for (const row of rows) {
    const status = row?.execution_status;
    const effectiveOutcome = outcome(row);
    if (["completed", "failed", "cancelled"].includes(String(status))) {
      terminalCount += 1;
      if (effectiveOutcome === "clear") {
        clearCount += 1;
      }
    }
    const completedAt = row?.completed_at;
    if (status !== "completed" || typeof completedAt !== "number") {
      continue;
    }
    const createdAt = row?.created_at;
    if (
      typeof createdAt !== "number" ||
      !Number.isSafeInteger(createdAt) ||
      !Number.isSafeInteger(completedAt) ||
      createdAt < 0 ||
      completedAt < createdAt
    ) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    durations.push(completedAt - createdAt);
  }
  return {
    clear_count: clearCount,
    duration_sample_count: durations.length,
    p95_duration_ms: nearestRankP95(durations),
    pass_rate: rate(clearCount, terminalCount),
    terminal_count: terminalCount,
    window,
  };
}

/** @param {number[]} values */
function numericSummary(values) {
  if (values.length === 0) {
    return null;
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
    median,
    total,
  };
}

/** @param {number[]} values */
function durationSummary(values) {
  const facts = numericSummary(values);
  return {
    execution_count: values.length,
    median_ms: facts?.median ?? null,
    total_ms: facts?.total ?? null,
  };
}

/** @param {number[]} values @param {number} population */
function tokenSummary(values, population) {
  const facts = numericSummary(values);
  return {
    coverage: rate(values.length, population),
    median: facts?.median ?? null,
    sum: facts?.total ?? null,
  };
}

/**
 * @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows
 * @param {Record<string, string>} terminalOutcomes
 * @param {{
 *   cancellationOutcomes?: Record<string, string>,
 *   includeUnstartedTerminals?: boolean
 * }} [options]
 */
export function deriveExecutionReliability(
  rows,
  terminalOutcomes,
  { cancellationOutcomes, includeUnstartedTerminals = false } = {},
) {
  const outcomeNames = [
    ...new Set([
      ...Object.values(terminalOutcomes),
      ...Object.values(cancellationOutcomes ?? {}),
    ]),
  ];
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
  let terminalReliability = 0;
  let terminalStarted = 0;
  for (const row of rows) {
    const status = row?.execution_status;
    const startedAt = row?.started_at;
    const completedAt = row?.completed_at;
    const errorCode = row?.error_code;
    const cancellationCode = row?.cancellation_code;
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
      (includeUnstartedTerminals &&
        ["failed", "cancelled"].includes(/** @type {string} */ (status)) &&
        startedAt === null &&
        typeof completedAt === "number") ||
      (status === "cancelled" &&
        ((startedAt === null && completedAt === null) ||
          (typeof startedAt === "number" && typeof completedAt === "number")));
    const failureValid =
      (status === "failed" &&
        typeof errorCode === "string" &&
        /^[a-z][a-z0-9_]*$/.test(errorCode)) ||
      (status !== "failed" && errorCode === null);
    const cancellationValid =
      cancellationOutcomes === undefined ||
      (status === "cancelled"
        ? typeof cancellationCode === "string" &&
          Object.hasOwn(cancellationOutcomes, cancellationCode)
        : cancellationCode === null ||
          (typeof cancellationCode === "string" &&
            Object.hasOwn(cancellationOutcomes, cancellationCode)));
    if (
      !timestampsValid ||
      !countersValid ||
      !stateValid ||
      !failureValid ||
      !cancellationValid ||
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
    const outcome =
      status === "cancelled" && cancellationOutcomes !== undefined
        ? cancellationOutcomes[/** @type {string} */ (cancellationCode)]
        : terminalOutcomes[/** @type {string} */ (status)];
    if (typeof outcome !== "string") {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    if (includeUnstartedTerminals || startedAt !== null) {
      outcomeCounts[outcome] += 1;
      terminalReliability += 1;
      if (status === "failed") {
        failureCodes.set(
          /** @type {string} */ (errorCode),
          (failureCodes.get(/** @type {string} */ (errorCode)) ?? 0) + 1,
        );
      }
    }
    if (startedAt === null || completedAt === null) {
      continue;
    }
    const duration = completedAt - startedAt;
    durations.terminal.push(duration);
    durations[outcome].push(duration);
    terminalStarted += 1;
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
        durationSummary(values),
      ]),
    ),
    ...Object.fromEntries(
      outcomeNames.flatMap((outcome) => [
        [outcome, outcomeCounts[outcome]],
        [`${outcome}_rate`, rate(outcomeCounts[outcome], terminalReliability)],
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
