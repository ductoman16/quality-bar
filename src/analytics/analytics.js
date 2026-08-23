import {
  AnalyticsError,
  deriveEvaluationOverview,
  deriveExecutionReliability,
} from "../execution-analytics.js";
import { evaluationOutcome } from "./analytics-evaluation-outcome.js";
import {
  derivePullRequestCriterionTransitions,
  validatedAnalyticsFilters,
} from "./analytics-filter.js";
import { readAnalyticsFactRows } from "./analytics-query.js";

export { AnalyticsError } from "../execution-analytics.js";

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

/** @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows @param {string[]} outcomes */
function countPopulation(rows, outcomes) {
  const counts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0]));
  for (const row of rows) {
    if (!outcomes.includes(String(row?.outcome))) {
      throw new AnalyticsError(
        "analytics_fact_invalid",
        "Canonical analytics fact is invalid",
      );
    }
    counts[String(row?.outcome)] += 1;
  }
  return counts;
}

/** @param {string} date */
function emptyTrendBucket(date) {
  return {
    advisory: 0,
    blocking: 0,
    clear: 0,
    date,
    error: 0,
    evaluations: 0,
    pending: 0,
  };
}

/** @param {number} ms */
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Per-day evaluation volume and outcome mix over the matched rows, as a
 * contiguous daily series (empty days filled with zeros) so the trend reads
 * honestly. Bucketed by the evaluation's request timestamp (UTC).
 * @param {Array<Record<string, import("node:sqlite").SQLInputValue>>} rows
 */
export function buildDailyTrend(rows) {
  const buckets = new Map();
  let earliest = null;
  let latest = null;
  for (const row of rows) {
    const day = dayKey(Number(row.created_at));
    if (earliest === null || day < earliest) {
      earliest = day;
    }
    if (latest === null || day > latest) {
      latest = day;
    }
    const bucket = buckets.get(day) ?? emptyTrendBucket(day);
    const outcome =
      /** @type {"advisory" | "blocking" | "clear" | "error" | "pending"} */ (
        row.terminal_outcome
      );
    bucket[outcome] += 1;
    bucket.evaluations += 1;
    buckets.set(day, bucket);
  }
  if (earliest === null || latest === null) {
    return [];
  }
  const trend = [];
  const end = Date.parse(latest + "T00:00:00.000Z");
  let cursor = Date.parse(earliest + "T00:00:00.000Z");
  for (let guard = 0; cursor <= end && guard < 366; guard += 1) {
    const day = dayKey(cursor);
    trend.push(buckets.get(day) ?? emptyTrendBucket(day));
    cursor += 86_400_000;
  }
  return trend;
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>
 * }} durableCore
 * @param {{now?: () => number}} [dependencies]
 */
export function createAnalyticsService(durableCore, { now = Date.now } = {}) {
  if (typeof durableCore?.all !== "function" || typeof now !== "function") {
    throw new TypeError("Analytics durable core is required");
  }
  return {
    /** @param {Record<string, unknown>} [inputFilters] */
    read(inputFilters) {
      const filters = validatedAnalyticsFilters(inputFilters);
      const overviewWindow = {
        end:
          filters.end === undefined
            ? now()
            : /** @type {number} */ (filters.end),
        start:
          filters.start === undefined
            ? 0
            : /** @type {number} */ (filters.start),
      };
      if (overviewWindow.end <= overviewWindow.start) {
        throw new AnalyticsError(
          "analytics_filter_invalid",
          "Analytics filter is invalid",
        );
      }
      if (!Number.isSafeInteger(overviewWindow.end)) {
        throw new AnalyticsError(
          "analytics_fact_invalid",
          "Canonical analytics fact is invalid",
        );
      }
      try {
        const {
          applicabilityRows,
          criterionRows,
          decisionRows,
          evaluationRows,
          evaluationOverviewRows,
          filteredEvaluationRows,
          findingRows,
          matchingCriterionRows,
          matchingFindingRows,
          matchingReviewRunRows,
          progressionRows,
          reviewRunRows,
          selectedCriterionScopes,
          selectedEvaluationIds,
          waiverAdjudicationRows,
          waiverRequestRows,
          waiverRows,
        } = readAnalyticsFactRows(
          durableCore,
          filters,
          evaluationOutcome,
          overviewWindow,
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
        const evaluationCounts = {
          advisory: 0,
          blocking: 0,
          clear: 0,
          error: 0,
          pending: 0,
        };
        for (const row of filteredEvaluationRows) {
          evaluationCounts[
            /** @type {"clear" | "advisory" | "blocking" | "error" | "pending"} */ (
              row.terminal_outcome
            )
          ] += 1;
        }
        const findingCounts = { advisory: 0, blocking: 0 };
        for (const row of findingRows) {
          if (!["advisory", "blocking"].includes(String(row?.finding_impact))) {
            throw new AnalyticsError(
              "analytics_fact_invalid",
              "Canonical analytics fact is invalid",
            );
          }
          findingCounts[
            /** @type {"advisory" | "blocking"} */ (row?.finding_impact)
          ] += 1;
        }
        let requestedFindings = 0;
        let waivedFindings = 0;
        for (const row of waiverRows) {
          if (
            ![0, 1].includes(/** @type {number} */ (row?.has_waiver_request)) ||
            ![0, 1].includes(/** @type {number} */ (row?.has_accepted_decision))
          ) {
            throw new AnalyticsError(
              "analytics_fact_invalid",
              "Canonical analytics fact is invalid",
            );
          }
          requestedFindings += /** @type {number} */ (row?.has_waiver_request);
          waivedFindings += /** @type {number} */ (row?.has_accepted_decision);
        }
        const decisionCounts = countPopulation(decisionRows, [
          "accepted",
          "denied",
          "error",
        ]);
        const terminalEvaluations =
          evaluationCounts.clear +
          evaluationCounts.advisory +
          evaluationCounts.blocking +
          evaluationCounts.error;
        const findings = findingCounts.advisory + findingCounts.blocking;
        const triggeredCriteria = criterionRows.filter(
          (row) => row?.outcome === "triggered",
        ).length;
        const decisions =
          decisionCounts.accepted +
          decisionCounts.denied +
          decisionCounts.error;
        const pendingEvaluations = filteredEvaluationRows.filter(
          (row) => row.terminal_outcome === "pending",
        ).length;
        const hasFilters = Object.keys(filters).length > 0;
        const pendingAdjudications = waiverAdjudicationRows.filter((row) =>
          ["queued", "running"].includes(String(row?.execution_status)),
        ).length;
        const matchingEventFacts =
          waiverRequestRows.length +
          decisionRows.length +
          waiverAdjudicationRows.length;
        /**
         * @param {Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>} rows
         * @param {import("node:sqlite").SQLInputValue | undefined} reviewRunId
         */
        const factsForRun = (rows, reviewRunId) =>
          rows.filter((row) => row?.review_run_id === reviewRunId);
        const matchingFacts = {
          evaluations: filteredEvaluationRows.map((row) => ({
            base_commit: row.base_commit,
            created_at: row.created_at,
            evaluation_id: row.analytics_evaluation_id,
            head_commit: row.head_commit,
            pull_request_number: row.automatic_pull_request_number,
            repository_id: row.repository_id,
            terminal_outcome: row.terminal_outcome,
          })),
          review_runs: matchingReviewRunRows.map((row) => ({
            base_commit: row?.base_commit,
            cached_input_tokens: row?.cached_input_tokens,
            cancellation_code: row?.cancellation_code,
            completed_at: row?.completed_at,
            created_at: row?.created_at,
            criterion_results: factsForRun(matchingCriterionRows, row?.id).map(
              (fact) => ({
                criterion_id: fact?.criterion_id,
                outcome: fact?.outcome,
              }),
            ),
            error_code: row?.error_code,
            evaluation_id: row?.evaluation_id,
            execution_status: row?.execution_status,
            findings: factsForRun(matchingFindingRows, row?.id).map((fact) => ({
              criterion_id: fact?.criterion_id,
              finding_id: fact?.finding_id,
              impact: fact?.finding_impact,
            })),
            head_commit: row?.head_commit,
            input_tokens: row?.input_tokens,
            model: row?.model,
            output_tokens: row?.output_tokens,
            pull_request_number: row?.pull_request_number,
            reasoning_effort: row?.reasoning_effort,
            repository_id: row?.repository_id,
            review_id: row?.review_id,
            review_run_id: row?.id,
            review_version_id: row?.review_version_id,
            service_tier: row?.service_tier,
            started_at: row?.started_at,
            waiver_decisions: factsForRun(decisionRows, row?.id).map(
              (fact) => ({
                created_at: fact?.created_at,
                outcome: fact?.outcome,
                waiver_decision_id: fact?.waiver_decision_id,
                waiver_request_id: fact?.waiver_request_id,
              }),
            ),
            waiver_requests: factsForRun(waiverRequestRows, row?.id).map(
              (fact) => ({
                created_at: fact?.created_at,
                finding_id: fact?.finding_id,
                waiver_request_id: fact?.waiver_request_id,
              }),
            ),
          })),
        };
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
          daily_trend: buildDailyTrend(filteredEvaluationRows),
          evaluation_overview: deriveEvaluationOverview(
            evaluationOverviewRows,
            evaluationOutcome,
            overviewWindow,
          ),
          evaluation_outcomes: {
            advisory: evaluationCounts.advisory,
            advisory_rate: rate(evaluationCounts.advisory, terminalEvaluations),
            blocking: evaluationCounts.blocking,
            blocking_rate: rate(evaluationCounts.blocking, terminalEvaluations),
            clear: evaluationCounts.clear,
            clear_rate: rate(evaluationCounts.clear, terminalEvaluations),
            error: evaluationCounts.error,
            error_rate: rate(evaluationCounts.error, terminalEvaluations),
            pending: evaluationCounts.pending,
          },
          finding_impact: {
            advisory: findingCounts.advisory,
            blocking: findingCounts.blocking,
            findings_per_triggered_criterion_result: rate(
              findings,
              triggeredCriteria,
            ),
          },
          matching_facts: matchingFacts,
          population: {
            filters,
            matching_evaluations: filteredEvaluationRows.length,
            matching_waiver_adjudications: waiverAdjudicationRows.length,
            matching_waiver_decisions: decisionRows.length,
            matching_waiver_requests: waiverRequestRows.length,
            pending_adjudications: pendingAdjudications,
            pending_evaluations: pendingEvaluations,
            state:
              evaluationRows.length === 0
                ? "no_evaluations"
                : hasFilters &&
                    filteredEvaluationRows.length === 0 &&
                    matchingEventFacts === 0
                  ? "no_filter_match"
                  : pendingEvaluations > 0 || pendingAdjudications > 0
                    ? "pending_data"
                    : "ready",
            total_evaluations: evaluationRows.length,
          },
          pull_request_criterion_transitions:
            derivePullRequestCriterionTransitions(
              /** @type {Record<string, unknown>[]} */ (progressionRows),
              selectedEvaluationIds,
              selectedCriterionScopes,
            ),
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
          review_run_reliability: deriveExecutionReliability(
            reviewRunRows,
            {
              completed: "successful",
              failed: "failed",
            },
            {
              cancellationOutcomes: {
                cancelled_by_operator: "operator_cancelled",
                cancelled_by_supersession: "superseded",
              },
            },
          ),
          waiver_analytics: {
            advisory_findings: waiverRows.length,
            decision_history: {
              accepted: decisionCounts.accepted,
              accepted_rate: rate(decisionCounts.accepted, decisions),
              denied: decisionCounts.denied,
              denied_rate: rate(decisionCounts.denied, decisions),
              error: decisionCounts.error,
              error_rate: rate(decisionCounts.error, decisions),
            },
            requested_findings: requestedFindings,
            waived_findings: waivedFindings,
            waived_finding_rate: rate(waivedFindings, waiverRows.length),
            waiver_request_rate: rate(requestedFindings, waiverRows.length),
          },
          waiver_adjudication_reliability: deriveExecutionReliability(
            waiverAdjudicationRows,
            {
              cancelled: "cancelled",
              completed: "completed",
              failed: "failed",
            },
            { includeUnstartedTerminals: true },
          ),
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
