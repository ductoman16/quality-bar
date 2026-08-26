import { AnalyticsError } from "../execution-analytics.ts";

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

function validCommit(value: unknown) {
  return (
    typeof value === "string" &&
    [40, 64].includes(value.length) &&
    !/[^0-9a-f]/.test(value)
  );
}

function validBoundary(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validatedAnalyticsFilters(input: unknown) {
  if (input === undefined) {
    return {};
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidFilter();
  }
  const filters = input as Record<string, unknown>;
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
        (filters.pull_request_number as number) <= 0)) ||
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

function matchesEvaluation(
  fact: Record<string, unknown>,
  filters: Record<string, unknown>,
) {
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
        fact.created_at >= (filters.start as number))) &&
    (filters.end === undefined ||
      (typeof fact.created_at === "number" &&
        fact.created_at < (filters.end as number))) &&
    (filters.terminal_outcome === undefined ||
      fact.terminal_outcome === filters.terminal_outcome)
  );
}

export function matchesAnalyticsReview(
  fact: Record<string, unknown>,
  filters: Record<string, unknown>,
) {
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

export function filteredEvaluationIds(
  evaluations: Record<string, unknown>[],
  progression: Record<string, unknown>[],
  filters: Record<string, unknown>,
) {
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

export function filteredReviewScopes(
  progression: Record<string, unknown>[],
  evaluationIds: Set<unknown>,
  filters: Record<string, unknown>,
) {
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

export function filteredCriterionScopes(
  progression: Record<string, unknown>[],
  evaluationIds: Set<unknown>,
  filters: Record<string, unknown>,
) {
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

export function derivePullRequestCriterionTransitions(
  rows: Record<string, unknown>[],
  evaluationIds: Set<unknown>,
  criterionScopes: Set<string>,
) {
  const groups: Map<string, Record<string, unknown>[]> = new Map();
  const evaluationPositions: Map<string, Map<string, number>> = new Map();
  const pullRequestEvaluations: Map<
    string,
    Map<string, Record<string, unknown>>
  > = new Map();
  for (const row of rows) {
    const criterionValid =
      row.criterion_id === null || typeof row.criterion_id === "string";
    const reviewValid =
      typeof row.review_id === "string" ||
      (row.criterion_id === null && row.review_id === null);
    if (
      typeof row.repository_id !== "string" ||
      !Number.isSafeInteger(row.pull_request_number) ||
      (row.pull_request_number as number) <= 0 ||
      !criterionValid ||
      typeof row.evaluation_id !== "string" ||
      !reviewValid ||
      !validBoundary(row.evaluation_created_at) ||
      (row.criterion_id === null && row.outcome !== null) ||
      !(
        row.outcome === null ||
        ["clear", "triggered", "not_applicable", "error"].includes(
          row.outcome as string,
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
          (positions?.get(String(previous.evaluation_id)) as number) + 1 ||
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
      }[current.outcome as string];
      if (name) {
        transitions[name as keyof typeof transitions] += 1;
        transitions.sample_size += 1;
      }
    }
  }
  return transitions;
}

function compareEvaluationOrder(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const time =
    (left.evaluation_created_at as number) -
    (right.evaluation_created_at as number);
  return time === 0
    ? (left.evaluation_id as string).localeCompare(
        right.evaluation_id as string,
      )
    : time;
}
