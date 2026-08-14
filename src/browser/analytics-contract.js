"use strict";

/** @param {unknown} value */
function validCount(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/** @param {any} candidate */
function validRate(candidate) {
  return (
    typeof candidate === "object" &&
    validCount(candidate?.numerator) &&
    validCount(candidate?.denominator)
  );
}

/** @param {any} candidate */
function validDuration(candidate) {
  return (
    typeof candidate === "object" &&
    validCount(candidate?.execution_count) &&
    (candidate?.median_ms === null ||
      (typeof candidate?.median_ms === "number" &&
        Number.isFinite(candidate.median_ms) &&
        candidate.median_ms >= 0)) &&
    (candidate?.total_ms === null || validCount(candidate?.total_ms))
  );
}

/** @param {any} candidate */
function validTokenCounter(candidate) {
  return (
    typeof candidate === "object" &&
    validRate(candidate?.coverage) &&
    (candidate?.median === null ||
      (typeof candidate?.median === "number" &&
        Number.isFinite(candidate.median) &&
        candidate.median >= 0)) &&
    (candidate?.sum === null || validCount(candidate?.sum))
  );
}

/** @param {any} candidate @param {string[]} outcomes */
function validExecutionReliability(candidate, outcomes) {
  return (
    typeof candidate === "object" &&
    validCount(candidate?.active) &&
    outcomes.every(
      (outcome) =>
        validCount(candidate?.[outcome]) &&
        validRate(candidate?.[`${outcome}_rate`]) &&
        validDuration(candidate?.duration?.[outcome]),
    ) &&
    validDuration(candidate?.duration?.terminal) &&
    Array.isArray(candidate?.failure_codes) &&
    candidate.failure_codes.every(
      (/** @type {any} */ failure) =>
        typeof failure?.code === "string" &&
        /^[a-z][a-z0-9_]*$/.test(failure.code) &&
        validCount(failure?.count),
    ) &&
    ["input_tokens", "cached_input_tokens", "output_tokens"].every((counter) =>
      validTokenCounter(candidate?.token_counters?.[counter]),
    )
  );
}

/** @param {unknown} candidate */
function validDailyTrend(candidate) {
  const keys = [
    "advisory",
    "blocking",
    "clear",
    "error",
    "evaluations",
    "pending",
  ];
  return (
    Array.isArray(candidate) &&
    candidate.every(
      (/** @type {any} */ bucket) =>
        typeof bucket?.date === "string" &&
        keys.every((key) => validCount(bucket?.[key])),
    )
  );
}

const analyticsContractWindow = /** @type {any} */ (window);
analyticsContractWindow.qualityBarAnalyticsContract = {
  validCount,
  validDailyTrend,
  validExecutionReliability,
};
