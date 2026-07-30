import { effectiveEvaluationOutcome } from "./waiver-effective-outcome.js";
import { EVALUATION_WAIVER_SELECTION } from "./evaluation-waiver-selection.js";
import {
  AnalyticsError,
  deriveExecutionReliability,
} from "./execution-analytics.js";

export { AnalyticsError } from "./execution-analytics.js";

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

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
function evaluationOutcome(row) {
  const facts = {
    activeAdjudicationCount: row?.active_waiver_adjudication_count,
    blockingFindingCount: row?.blocking_finding_count,
    currentWaiverErrorCount: row?.current_waiver_error_count,
    unwaivedAdvisoryFindingCount: row?.unwaived_advisory_finding_count,
  };
  const storedOutcome = row?.result_outcome;
  const executionStatus = row?.execution_status;
  if (
    !Object.values(facts).every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) ||
    !["queued", "running", "completed", "failed", "cancelled"].includes(
      /** @type {string} */ (executionStatus),
    ) ||
    !(
      storedOutcome === null ||
      ["clear", "advisory", "blocking", "error"].includes(
        /** @type {string} */ (storedOutcome),
      )
    ) ||
    (storedOutcome === null && executionStatus === "completed") ||
    (storedOutcome !== null &&
      ["queued", "running"].includes(/** @type {string} */ (executionStatus)))
  ) {
    throw new AnalyticsError(
      "analytics_fact_invalid",
      "Canonical analytics fact is invalid",
    );
  }
  const resultOutcome =
    storedOutcome !== null
      ? /** @type {string} */ (storedOutcome)
      : ["failed", "cancelled"].includes(
            /** @type {string} */ (executionStatus),
          )
        ? "error"
        : "pending";
  return effectiveEvaluationOutcome({
    activeAdjudicationCount: /** @type {number} */ (
      facts.activeAdjudicationCount
    ),
    blockingFindingCount: /** @type {number} */ (facts.blockingFindingCount),
    currentWaiverErrorCount: /** @type {number} */ (
      facts.currentWaiverErrorCount
    ),
    resultOutcome,
    unwaivedAdvisoryFindingCount: /** @type {number} */ (
      facts.unwaivedAdvisoryFindingCount
    ),
  });
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
        const evaluationRows = durableCore.all(
          `${EVALUATION_WAIVER_SELECTION}
           evaluations.id AS analytics_evaluation_id
           FROM evaluations
           JOIN repositories ON repositories.id = evaluations.repository_id
           LEFT JOIN github_automatic_evaluations
             ON github_automatic_evaluations.evaluation_id = evaluations.id
           LEFT JOIN evaluation_results
             ON evaluation_results.evaluation_id = evaluations.id
           ORDER BY evaluations.rowid`,
        );
        const findingRows = durableCore.all(
          `SELECT review_version_criteria.impact AS finding_impact
             FROM findings
             JOIN review_runs ON review_runs.id = findings.review_run_id
             JOIN review_version_criteria
               ON review_version_criteria.review_version_id =
                    review_runs.review_version_id
              AND review_version_criteria.criterion_id = findings.criterion_id
            ORDER BY findings.rowid`,
        );
        const waiverRows = durableCore.all(
          `SELECT
             EXISTS (
               SELECT 1 FROM waiver_requests
                WHERE waiver_requests.finding_id = findings.id
             ) AS has_waiver_request,
             EXISTS (
               SELECT 1
                 FROM waiver_requests
                 JOIN waiver_decisions
                   ON waiver_decisions.waiver_request_id = waiver_requests.id
                WHERE waiver_requests.finding_id = findings.id
                  AND waiver_decisions.outcome = 'accepted'
             ) AS has_accepted_decision
             FROM findings
             JOIN review_runs ON review_runs.id = findings.review_run_id
             JOIN review_version_criteria
               ON review_version_criteria.review_version_id =
                    review_runs.review_version_id
              AND review_version_criteria.criterion_id = findings.criterion_id
            WHERE review_version_criteria.impact = 'advisory'
            ORDER BY findings.rowid`,
        );
        const decisionRows = durableCore.all(
          `SELECT outcome
             FROM waiver_decisions
            ORDER BY rowid`,
        );
        const reviewRunRows = durableCore.all(
          `SELECT analytics_review_runs.execution_status,
                  analytics_review_runs.started_at,
                  analytics_review_runs.completed_at,
                  analytics_review_runs.error_code,
                  analytics_review_runs.input_tokens,
                  analytics_review_runs.cached_input_tokens,
                  analytics_review_runs.output_tokens,
                  evaluations.cancellation_code
             FROM review_runs AS analytics_review_runs
             JOIN evaluations
               ON evaluations.id = analytics_review_runs.evaluation_id
            ORDER BY analytics_review_runs.rowid`,
        );
        const waiverAdjudicationRows = durableCore.all(
          `SELECT execution_status, started_at, completed_at, error_code,
                  input_tokens, cached_input_tokens, output_tokens
             FROM waiver_adjudications AS analytics_waiver_adjudications
            ORDER BY rowid`,
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
        for (const row of evaluationRows) {
          evaluationCounts[evaluationOutcome(row)] += 1;
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
              cancelled_by_operator: "operator_cancelled",
              cancelled_by_supersession: "superseded",
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
