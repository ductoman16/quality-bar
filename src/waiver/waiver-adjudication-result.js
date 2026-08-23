import { ReviewRunExecutionError } from "../review/review-run-result.js";

/** @returns {never} */
function invalidSubmission() {
  throw new ReviewRunExecutionError(
    "waiver_adjudication_submission_invalid",
    "Waiver Adjudication submission must contain exactly one complete Decision per selected Request",
  );
}

/** @param {unknown} value */
const nonblank = (value) =>
  typeof value === "string" && value.trim().length > 0;

/** @param {unknown} value */
const stableCode = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value);

/**
 * @param {unknown} candidate
 * @param {{id: string}[]} requests
 */
export function validateWaiverAdjudicationSubmission(candidate, requests) {
  const input = /** @type {any} */ (candidate);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.decisions) ||
    !Array.isArray(requests) ||
    requests.length === 0 ||
    input.decisions.length !== requests.length
  ) {
    invalidSubmission();
  }
  const selected = new Set(requests.map(({ id }) => id));
  if (
    selected.size !== requests.length ||
    [...selected].some((id) => !nonblank(id))
  ) {
    throw new TypeError("Frozen Waiver Request identity is invalid");
  }
  const seen = new Set();
  const decisions = input.decisions.map(
    (/** @type {any} */ decision, /** @type {number} */ index) => {
      if (
        !decision ||
        typeof decision !== "object" ||
        Array.isArray(decision) ||
        !nonblank(decision.request_id) ||
        !selected.has(decision.request_id) ||
        decision.request_id !== requests[index].id ||
        seen.has(decision.request_id) ||
        !["accepted", "denied", "error"].includes(decision.outcome)
      ) {
        invalidSubmission();
      }
      seen.add(decision.request_id);
      if (decision.outcome === "error") {
        if (
          Object.keys(decision).length !== 3 ||
          !decision.error ||
          typeof decision.error !== "object" ||
          Array.isArray(decision.error) ||
          Object.keys(decision.error).length !== 2 ||
          !stableCode(decision.error.code) ||
          !nonblank(decision.error.detail)
        ) {
          invalidSubmission();
        }
        return {
          error: {
            code: decision.error.code,
            detail: decision.error.detail.trim(),
          },
          outcome: decision.outcome,
          request_id: decision.request_id,
        };
      }
      if (
        Object.keys(decision).length !== 3 ||
        !nonblank(decision.explanation)
      ) {
        invalidSubmission();
      }
      return {
        explanation: decision.explanation.trim(),
        outcome: decision.outcome,
        request_id: decision.request_id,
      };
    },
  );
  if (seen.size !== selected.size) {
    invalidSubmission();
  }
  return decisions;
}
