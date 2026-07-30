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

/** @param {any} candidate */
function validMatchingFacts(candidate) {
  const validString = (/** @type {unknown} */ value) =>
    typeof value === "string" && value.length > 0;
  const validNullableCount = (/** @type {unknown} */ value) =>
    value === null || validCount(value);
  const validCommit = (/** @type {unknown} */ value) =>
    typeof value === "string" &&
    [40, 64].includes(value.length) &&
    !/[^0-9a-f]/.test(value);
  const validErrorCode = (/** @type {unknown} */ value) =>
    value === null ||
    (typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value));
  const validCriterion = (/** @type {any} */ fact) =>
    validString(fact?.criterion_id) &&
    ["clear", "triggered", "not_applicable", "error"].includes(fact?.outcome);
  const validFinding = (/** @type {any} */ fact) =>
    validString(fact?.finding_id) &&
    validString(fact?.criterion_id) &&
    ["advisory", "blocking"].includes(fact?.impact);
  const validRequest = (/** @type {any} */ fact) =>
    validString(fact?.waiver_request_id) &&
    validString(fact?.finding_id) &&
    validCount(fact?.created_at);
  const validDecision = (/** @type {any} */ fact) =>
    validString(fact?.waiver_decision_id) &&
    validString(fact?.waiver_request_id) &&
    ["accepted", "denied", "error"].includes(fact?.outcome) &&
    validCount(fact?.created_at);
  return (
    typeof candidate === "object" &&
    Array.isArray(candidate?.evaluations) &&
    Array.isArray(candidate?.review_runs) &&
    candidate.evaluations.every(
      (/** @type {any} */ fact) =>
        validString(fact?.evaluation_id) &&
        validString(fact?.repository_id) &&
        validCommit(fact?.base_commit) &&
        validCommit(fact?.head_commit) &&
        (fact?.pull_request_number === null ||
          (Number.isSafeInteger(fact?.pull_request_number) &&
            fact.pull_request_number > 0)) &&
        validCount(fact?.created_at) &&
        ["clear", "advisory", "blocking", "error", "pending"].includes(
          fact?.terminal_outcome,
        ),
    ) &&
    candidate.review_runs.every(
      (/** @type {any} */ fact) =>
        validString(fact?.review_run_id) &&
        validString(fact?.evaluation_id) &&
        validString(fact?.repository_id) &&
        validCommit(fact?.base_commit) &&
        validCommit(fact?.head_commit) &&
        (fact?.pull_request_number === null ||
          (Number.isSafeInteger(fact?.pull_request_number) &&
            fact.pull_request_number > 0)) &&
        validString(fact?.review_id) &&
        validString(fact?.review_version_id) &&
        validString(fact?.model) &&
        validString(fact?.reasoning_effort) &&
        validString(fact?.service_tier) &&
        ["queued", "running", "completed", "failed", "cancelled"].includes(
          fact?.execution_status,
        ) &&
        (fact?.cancellation_code === null ||
          ["cancelled_by_operator", "cancelled_by_supersession"].includes(
            fact?.cancellation_code,
          )) &&
        validCount(fact?.created_at) &&
        validNullableCount(fact?.started_at) &&
        validNullableCount(fact?.completed_at) &&
        validErrorCode(fact?.error_code) &&
        validNullableCount(fact?.input_tokens) &&
        validNullableCount(fact?.cached_input_tokens) &&
        validNullableCount(fact?.output_tokens) &&
        Array.isArray(fact?.criterion_results) &&
        fact.criterion_results.every(validCriterion) &&
        Array.isArray(fact?.findings) &&
        fact.findings.every(validFinding) &&
        Array.isArray(fact?.waiver_requests) &&
        fact.waiver_requests.every(validRequest) &&
        Array.isArray(fact?.waiver_decisions) &&
        fact.waiver_decisions.every(validDecision),
    )
  );
}

const analyticsContractWindow = /** @type {any} */ (window);
analyticsContractWindow.qualityBarAnalyticsContract = {
  validCount,
  validExecutionReliability,
  validMatchingFacts,
};
