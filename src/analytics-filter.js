import { AnalyticsError } from "./execution-analytics.js";

const STRING_FILTERS = new Set([
  "criterion_id",
  "model",
  "reasoning_effort",
  "repository_id",
  "review_id",
  "review_version_id",
  "service_tier",
]);
const FILTER_NAMES = new Set([
  ...STRING_FILTERS,
  "base_commit",
  "end",
  "head_commit",
  "pull_request_number",
  "start",
  "terminal_outcome",
]);
const TERMINAL_OUTCOMES = new Set(["advisory", "blocking", "clear", "error"]);

function invalidFilter() {
  throw new AnalyticsError(
    "analytics_filter_invalid",
    "Analytics filter is invalid",
  );
}

/** @param {unknown} value */
function validCommit(value) {
  return (
    typeof value === "string" &&
    [40, 64].includes(value.length) &&
    !/[^0-9a-f]/.test(value)
  );
}

/** @param {unknown} value */
function validBoundary(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/** @param {unknown} input */
export function validatedAnalyticsFilters(input) {
  if (input === undefined) {
    return {};
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidFilter();
  }
  const filters = /** @type {Record<string, unknown>} */ (input);
  if (
    Object.keys(filters).some((name) => !FILTER_NAMES.has(name)) ||
    [...STRING_FILTERS].some(
      (name) =>
        filters[name] !== undefined &&
        (typeof filters[name] !== "string" || filters[name] === ""),
    ) ||
    (filters.base_commit !== undefined && !validCommit(filters.base_commit)) ||
    (filters.head_commit !== undefined && !validCommit(filters.head_commit)) ||
    (filters.base_commit === undefined) !==
      (filters.head_commit === undefined) ||
    (typeof filters.base_commit === "string" &&
      typeof filters.head_commit === "string" &&
      filters.base_commit.length !== filters.head_commit.length) ||
    (filters.pull_request_number !== undefined &&
      (!Number.isSafeInteger(filters.pull_request_number) ||
        /** @type {number} */ (filters.pull_request_number) <= 0)) ||
    (filters.start !== undefined && !validBoundary(filters.start)) ||
    (filters.end !== undefined && !validBoundary(filters.end)) ||
    (typeof filters.start === "number" &&
      typeof filters.end === "number" &&
      filters.start >= filters.end) ||
    (filters.terminal_outcome !== undefined &&
      !TERMINAL_OUTCOMES.has(String(filters.terminal_outcome)))
  ) {
    invalidFilter();
  }
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  );
}

/** @param {Record<string, unknown>} fact @param {Record<string, unknown>} filters */
function matchesEvaluation(fact, filters) {
  return (
    (filters.repository_id === undefined ||
      fact.repository_id === filters.repository_id) &&
    (filters.base_commit === undefined ||
      (fact.base_commit === filters.base_commit &&
        fact.head_commit === filters.head_commit)) &&
    (filters.pull_request_number === undefined ||
      fact.automatic_pull_request_number === filters.pull_request_number) &&
    (filters.start === undefined ||
      (typeof fact.created_at === "number" &&
        fact.created_at >= /** @type {number} */ (filters.start))) &&
    (filters.end === undefined ||
      (typeof fact.created_at === "number" &&
        fact.created_at < /** @type {number} */ (filters.end))) &&
    (filters.terminal_outcome === undefined ||
      fact.terminal_outcome === filters.terminal_outcome)
  );
}

/** @param {Record<string, unknown>} fact @param {Record<string, unknown>} filters */
export function matchesAnalyticsReview(fact, filters) {
  return (
    (filters.review_id === undefined || fact.review_id === filters.review_id) &&
    (filters.review_version_id === undefined ||
      fact.review_version_id === filters.review_version_id) &&
    (filters.criterion_id === undefined ||
      fact.criterion_id === filters.criterion_id) &&
    (filters.model === undefined || fact.model === filters.model) &&
    (filters.reasoning_effort === undefined ||
      fact.reasoning_effort === filters.reasoning_effort) &&
    (filters.service_tier === undefined ||
      fact.service_tier === filters.service_tier)
  );
}

/**
 * @param {Record<string, unknown>[]} evaluations
 * @param {Record<string, unknown>[]} progression
 * @param {Record<string, unknown>} filters
 */
export function filteredEvaluationIds(evaluations, progression, filters) {
  const needsReviewMatch = [
    "review_id",
    "review_version_id",
    "criterion_id",
    "model",
    "reasoning_effort",
    "service_tier",
  ].some((name) => filters[name] !== undefined);
  const matchingReviewEvaluations = new Set(
    progression
      .filter((fact) => matchesAnalyticsReview(fact, filters))
      .map((fact) => fact.evaluation_id),
  );
  return new Set(
    evaluations
      .filter(
        (fact) =>
          matchesEvaluation(fact, filters) &&
          (!needsReviewMatch ||
            matchingReviewEvaluations.has(fact.analytics_evaluation_id)),
      )
      .map((fact) => fact.analytics_evaluation_id)
      .filter((id) => typeof id === "string"),
  );
}

/**
 * @param {Record<string, unknown>[]} progression
 * @param {Set<unknown>} evaluationIds
 * @param {Record<string, unknown>} filters
 */
export function filteredReviewScopes(progression, evaluationIds, filters) {
  return new Set(
    progression
      .filter(
        (fact) =>
          evaluationIds.has(fact.evaluation_id) &&
          matchesAnalyticsReview(fact, filters),
      )
      .map((fact) => [fact.evaluation_id, fact.review_id].join("\0")),
  );
}

/**
 * @param {Record<string, unknown>[]} progression
 * @param {Set<unknown>} evaluationIds
 * @param {Record<string, unknown>} filters
 */
export function filteredCriterionScopes(progression, evaluationIds, filters) {
  return new Set(
    progression
      .filter(
        (fact) =>
          evaluationIds.has(fact.evaluation_id) &&
          matchesAnalyticsReview(fact, filters),
      )
      .map((fact) =>
        [fact.evaluation_id, fact.review_id, fact.criterion_id].join("\0"),
      ),
  );
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {Set<unknown>} evaluationIds
 * @param {Set<string>} criterionScopes
 */
export function derivePullRequestCriterionTransitions(
  rows,
  evaluationIds,
  criterionScopes,
) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const groups = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const evaluationPositions = new Map();
  /** @type {Map<string, Map<string, Record<string, unknown>>>} */
  const pullRequestEvaluations = new Map();
  for (const row of rows) {
    const criterionValid =
      row.criterion_id === null || typeof row.criterion_id === "string";
    const reviewValid =
      typeof row.review_id === "string" ||
      (row.criterion_id === null && row.review_id === null);
    if (
      typeof row.repository_id !== "string" ||
      !Number.isSafeInteger(row.pull_request_number) ||
      /** @type {number} */ (row.pull_request_number) <= 0 ||
      !criterionValid ||
      typeof row.evaluation_id !== "string" ||
      !reviewValid ||
      !validBoundary(row.evaluation_created_at) ||
      (row.criterion_id === null && row.outcome !== null) ||
      !(
        row.outcome === null ||
        ["clear", "triggered", "not_applicable", "error"].includes(
          /** @type {string} */ (row.outcome),
        )
      )
    ) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    const pullRequestKey = [row.repository_id, row.pull_request_number].join(
      "\0",
    );
    const evaluations = pullRequestEvaluations.get(pullRequestKey) ?? new Map();
    evaluations.set(row.evaluation_id, row);
    pullRequestEvaluations.set(pullRequestKey, evaluations);
    if (row.criterion_id === null) {
      continue;
    }
    const key = [pullRequestKey, row.criterion_id].join("\0");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const [key, evaluations] of pullRequestEvaluations) {
    const ordered = [...evaluations.values()].sort(compareEvaluationOrder);
    evaluationPositions.set(
      key,
      new Map(ordered.map((row, index) => [String(row.evaluation_id), index])),
    );
  }
  const transitions = {
    no_longer_applicable: 0,
    sample_size: 0,
    triggered_to_clear: 0,
    triggered_to_error: 0,
  };
  for (const [key, group] of groups) {
    group.sort(compareEvaluationOrder);
    const positions = evaluationPositions.get(
      key.slice(0, key.lastIndexOf("\0")),
    );
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (
        positions?.get(String(current.evaluation_id)) !==
          /** @type {number} */ (
            positions?.get(String(previous.evaluation_id))
          ) +
            1 ||
        !evaluationIds.has(previous.evaluation_id) ||
        !evaluationIds.has(current.evaluation_id) ||
        !criterionScopes.has(
          [
            previous.evaluation_id,
            previous.review_id,
            previous.criterion_id,
          ].join("\0"),
        ) ||
        !criterionScopes.has(
          [current.evaluation_id, current.review_id, current.criterion_id].join(
            "\0",
          ),
        ) ||
        previous.outcome !== "triggered" ||
        current.outcome === null
      ) {
        continue;
      }
      const name = {
        clear: "triggered_to_clear",
        error: "triggered_to_error",
        not_applicable: "no_longer_applicable",
      }[/** @type {string} */ (current.outcome)];
      if (name) {
        transitions[/** @type {keyof typeof transitions} */ (name)] += 1;
        transitions.sample_size += 1;
      }
    }
  }
  return transitions;
}

/** @param {Record<string, unknown>} left @param {Record<string, unknown>} right */
function compareEvaluationOrder(left, right) {
  const time =
    /** @type {number} */ (left.evaluation_created_at) -
    /** @type {number} */ (right.evaluation_created_at);
  return time === 0
    ? /** @type {string} */ (left.evaluation_id).localeCompare(
        /** @type {string} */ (right.evaluation_id),
      )
    : time;
}
