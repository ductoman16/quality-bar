const EXECUTION_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const REVIEW_COUNT_KEYS = [
  "total",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];
const OUTCOME_COUNT_KEYS = ["clear", "triggered", "not_applicable", "error"];
const FINDING_COUNT_KEYS = ["total", "advisory", "blocking"];

function validCounts(value: unknown, keys: string[]) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const counts = value as Record<string, unknown>;
  return (
    Object.keys(counts).length === keys.length &&
    keys.every(
      (key) =>
        key in counts &&
        Number.isSafeInteger(counts[key]) &&
        (counts[key] as number) >= 0,
    )
  );
}
function validNode(node: unknown) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }
  const candidate = node as Record<string, unknown>;
  if (candidate.kind === "system") {
    return (
      Object.keys(candidate).length === 4 &&
      typeof candidate.key === "string" &&
      ["preparing", "finalizing"].includes(candidate.key) &&
      candidate.label ===
        (candidate.key === "preparing" ? "Preparing" : "Finalizing") &&
      typeof candidate.status === "string" &&
      EXECUTION_STATUSES.has(candidate.status)
    );
  }
  return (
    candidate.kind === "review" &&
    Object.keys(candidate).length === 6 &&
    typeof candidate.review_id === "string" &&
    candidate.review_id.length > 0 &&
    typeof candidate.review_version_id === "string" &&
    candidate.review_version_id.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    [null, "clear", "advisory", "blocking", "error"].includes(
      candidate.outcome as string | null,
    ) &&
    typeof candidate.status === "string" &&
    EXECUTION_STATUSES.has(candidate.status)
  );
}
export function validEvaluationMonitor(monitor: unknown) {
  if (!monitor || typeof monitor !== "object" || Array.isArray(monitor)) {
    return false;
  }
  const value = monitor as Record<string, unknown>;
  const nodes = value.nodes;
  return (
    Object.keys(value).length === 5 &&
    Array.isArray(nodes) &&
    nodes.length >= 2 &&
    nodes.every(validNode) &&
    (nodes[0] as Record<string, unknown>).kind === "system" &&
    (nodes[0] as Record<string, unknown>).key === "preparing" &&
    (nodes.at(-1) as Record<string, unknown>).kind === "system" &&
    (nodes.at(-1) as Record<string, unknown>).key === "finalizing" &&
    validCounts(value.review_counts, REVIEW_COUNT_KEYS) &&
    (value.outcome_counts === null ||
      validCounts(value.outcome_counts, OUTCOME_COUNT_KEYS)) &&
    (value.finding_counts === null ||
      validCounts(value.finding_counts, FINDING_COUNT_KEYS)) &&
    (value.duration_ms === null ||
      (typeof value.duration_ms === "number" &&
        Number.isSafeInteger(value.duration_ms) &&
        value.duration_ms >= 0)) &&
    (value.review_counts as Record<string, number>).total ===
      nodes.filter(
        (node) => (node as Record<string, unknown>).kind === "review",
      ).length
  );
}
function evaluationFacts(
  evaluation: Record<string, import("node:sqlite").SQLInputValue>,
) {
  if (
    !evaluation ||
    typeof evaluation.id !== "string" ||
    evaluation.id.length === 0 ||
    !EXECUTION_STATUSES.has(evaluation.execution_status as string) ||
    !Number.isSafeInteger(evaluation.created_at) ||
    !(
      evaluation.completed_at === null ||
      Number.isSafeInteger(evaluation.completed_at)
    ) ||
    !(
      evaluation.applicability_sealed_at === null ||
      Number.isSafeInteger(evaluation.applicability_sealed_at)
    )
  ) {
    throw new TypeError("Evaluation monitor facts are invalid");
  }
  return evaluation;
}

function preparingStatus(
  evaluation: Record<string, import("node:sqlite").SQLInputValue>,
) {
  if (evaluation.applicability_sealed_at !== null) {
    return "completed";
  }
  return evaluation.execution_status as string;
}

function finalizingStatus(
  evaluation: Record<string, import("node:sqlite").SQLInputValue>,
  activeReviewRuns: number,
) {
  if (TERMINAL_STATUSES.has(evaluation.execution_status as string)) {
    return evaluation.execution_status as string;
  }
  if (evaluation.execution_status === "running" && activeReviewRuns === 0) {
    return "running";
  }
  return "queued";
}

function countsFrom(
  row: Record<string, import("node:sqlite").SQLInputValue>,
  prefix: string,
  keys: string[],
) {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    const value = row[`${prefix}_${key}`];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new TypeError("Evaluation monitor count is invalid");
    }
    counts[key] = value as number;
  }
  return counts;
}

export function readEvaluationMonitors(
  durableCore: { all: Function },
  evaluations: (
    | Record<string, import("node:sqlite").SQLInputValue>
    | undefined
  )[],
) {
  if (
    !durableCore ||
    typeof durableCore.all !== "function" ||
    !Array.isArray(evaluations)
  ) {
    throw new TypeError("Evaluation monitor reader dependencies are invalid");
  }
  const facts = new Map();
  for (const evaluation of evaluations) {
    const value = evaluationFacts(
      evaluation as Record<string, import("node:sqlite").SQLInputValue>,
    );
    if (facts.has(value.id)) {
      throw new TypeError("Evaluation monitor IDs must be unique");
    }
    facts.set(value.id, value);
  }
  if (facts.size === 0) {
    return new Map();
  }
  const values = [...facts.keys()].map(() => "(?)").join(", ");
  const rows = durableCore.all(
    `WITH requested(evaluation_id) AS (VALUES ${values}),
      review_counts AS (
        SELECT review_runs.evaluation_id,
          count(*) AS total,
          count(*) FILTER (WHERE review_runs.execution_status = 'queued') AS queued,
          count(*) FILTER (WHERE review_runs.execution_status = 'running') AS running,
          count(*) FILTER (WHERE review_runs.execution_status = 'completed') AS completed,
          count(*) FILTER (WHERE review_runs.execution_status = 'failed') AS failed,
          count(*) FILTER (WHERE review_runs.execution_status = 'cancelled') AS cancelled
        FROM review_runs
        JOIN requested ON requested.evaluation_id = review_runs.evaluation_id
        GROUP BY review_runs.evaluation_id
      ),
      outcome_counts AS (
        SELECT review_runs.evaluation_id,
          count(*) FILTER (WHERE criterion_results.outcome = 'clear') AS clear,
          count(*) FILTER (WHERE criterion_results.outcome = 'triggered') AS triggered,
          count(*) FILTER (WHERE criterion_results.outcome = 'not_applicable') AS not_applicable,
          count(*) FILTER (WHERE criterion_results.outcome = 'error') AS error
        FROM criterion_results
        JOIN review_runs ON review_runs.id = criterion_results.review_run_id
        JOIN requested ON requested.evaluation_id = review_runs.evaluation_id
        GROUP BY review_runs.evaluation_id
      ),
      finding_counts AS (
        SELECT findings.evaluation_id,
          count(*) AS total,
          count(*) FILTER (WHERE review_version_criteria.impact = 'advisory') AS advisory,
          count(*) FILTER (WHERE review_version_criteria.impact = 'blocking') AS blocking
        FROM findings
        JOIN requested ON requested.evaluation_id = findings.evaluation_id
        JOIN review_runs ON review_runs.id = findings.review_run_id
        JOIN review_version_criteria
          ON review_version_criteria.review_version_id = review_runs.review_version_id
         AND review_version_criteria.criterion_id = findings.criterion_id
        GROUP BY findings.evaluation_id
      )
      SELECT requested.evaluation_id,
        evaluation_results.evaluation_id AS result_evaluation_id,
        COALESCE(review_counts.total, 0) AS review_total,
        COALESCE(review_counts.queued, 0) AS review_queued,
        COALESCE(review_counts.running, 0) AS review_running,
        COALESCE(review_counts.completed, 0) AS review_completed,
        COALESCE(review_counts.failed, 0) AS review_failed,
        COALESCE(review_counts.cancelled, 0) AS review_cancelled,
        COALESCE(outcome_counts.clear, 0) AS outcome_clear,
        COALESCE(outcome_counts.triggered, 0) AS outcome_triggered,
        COALESCE(outcome_counts.not_applicable, 0) AS outcome_not_applicable,
        COALESCE(outcome_counts.error, 0) AS outcome_error,
        COALESCE(finding_counts.total, 0) AS finding_total,
        COALESCE(finding_counts.advisory, 0) AS finding_advisory,
        COALESCE(finding_counts.blocking, 0) AS finding_blocking,
        review_runs.id AS review_run_id,
        review_runs.review_id,
        review_runs.review_version_id,
        review_runs.execution_status AS review_execution_status,
        EXISTS (
          SELECT 1 FROM criterion_results AS review_criterion_results
          WHERE review_criterion_results.review_run_id = review_runs.id
            AND review_criterion_results.outcome = 'error'
        ) AS review_has_error,
        EXISTS (
          SELECT 1
          FROM criterion_results AS review_criterion_results
          JOIN review_version_criteria
            ON review_version_criteria.review_version_id = review_runs.review_version_id
           AND review_version_criteria.criterion_id = review_criterion_results.criterion_id
          WHERE review_criterion_results.review_run_id = review_runs.id
            AND review_criterion_results.outcome = 'triggered'
            AND review_version_criteria.impact = 'blocking'
        ) AS review_has_blocking,
        EXISTS (
          SELECT 1
          FROM criterion_results AS review_criterion_results
          JOIN review_version_criteria
            ON review_version_criteria.review_version_id = review_runs.review_version_id
           AND review_version_criteria.criterion_id = review_criterion_results.criterion_id
          WHERE review_criterion_results.review_run_id = review_runs.id
            AND review_criterion_results.outcome = 'triggered'
            AND review_version_criteria.impact = 'advisory'
        ) AS review_has_advisory,
        reviews.name AS review_name
      FROM requested
      LEFT JOIN evaluation_results
        ON evaluation_results.evaluation_id = requested.evaluation_id
      LEFT JOIN review_counts
        ON review_counts.evaluation_id = requested.evaluation_id
      LEFT JOIN outcome_counts
        ON outcome_counts.evaluation_id = requested.evaluation_id
      LEFT JOIN finding_counts
        ON finding_counts.evaluation_id = requested.evaluation_id
      LEFT JOIN review_runs
        ON review_runs.evaluation_id = requested.evaluation_id
      LEFT JOIN reviews ON reviews.id = review_runs.review_id
      ORDER BY requested.evaluation_id, reviews.id ASC, review_runs.id ASC`,
    ...facts.keys(),
  );
  if (!Array.isArray(rows)) {
    throw new TypeError("Evaluation monitor rows are invalid");
  }
  const monitors = new Map();
  for (const id of facts.keys()) {
    monitors.set(id, { nodes: [], summary: null });
  }
  for (const row of rows) {
    if (
      !row ||
      typeof row.evaluation_id !== "string" ||
      !monitors.has(row.evaluation_id)
    ) {
      throw new TypeError("Evaluation monitor row is invalid");
    }
    const monitor = monitors.get(row.evaluation_id);
    const reviewCounts = countsFrom(row, "review", REVIEW_COUNT_KEYS);
    const hasResult = row.result_evaluation_id !== null;
    if (hasResult && row.result_evaluation_id !== row.evaluation_id) {
      throw new TypeError("Evaluation monitor result row is invalid");
    }
    const summary = {
      finding_counts: hasResult
        ? countsFrom(row, "finding", FINDING_COUNT_KEYS)
        : null,
      outcome_counts: hasResult
        ? countsFrom(row, "outcome", OUTCOME_COUNT_KEYS)
        : null,
      review_counts: reviewCounts,
    };
    if (monitor.summary === null) {
      monitor.summary = summary;
    } else if (JSON.stringify(monitor.summary) !== JSON.stringify(summary)) {
      throw new TypeError("Evaluation monitor summary is inconsistent");
    }
    if (row.review_run_id === null) {
      if (
        row.review_id !== null ||
        row.review_version_id !== null ||
        row.review_execution_status !== null ||
        row.review_name !== null
      ) {
        throw new TypeError("Evaluation monitor review row is invalid");
      }
      continue;
    }
    if (
      typeof row.review_run_id !== "string" ||
      typeof row.review_id !== "string" ||
      typeof row.review_version_id !== "string" ||
      typeof row.review_name !== "string" ||
      row.review_name.length === 0 ||
      ![0, 1].includes(row.review_has_error) ||
      ![0, 1].includes(row.review_has_blocking) ||
      ![0, 1].includes(row.review_has_advisory) ||
      !EXECUTION_STATUSES.has(row.review_execution_status)
    ) {
      throw new TypeError("Evaluation monitor review row is invalid");
    }
    monitor.nodes.push({
      kind: "review",
      label: row.review_name,
      outcome:
        !hasResult || row.review_execution_status !== "completed"
          ? null
          : row.review_has_error === 1
            ? "error"
            : row.review_has_blocking === 1
              ? "blocking"
              : row.review_has_advisory === 1
                ? "advisory"
                : "clear",
      review_id: row.review_id,
      review_version_id: row.review_version_id,
      status: row.review_execution_status,
    });
  }
  const result = new Map();
  for (const [id, monitor] of monitors) {
    if (monitor.summary === null) {
      throw new TypeError("Evaluation monitor is missing");
    }
    const evaluation = facts.get(id);
    const duration =
      evaluation.completed_at === null
        ? null
        : evaluation.completed_at - evaluation.created_at;
    if (duration !== null && duration < 0) {
      throw new TypeError("Evaluation monitor duration is invalid");
    }
    const activeReviewRuns =
      monitor.summary.review_counts.queued +
      monitor.summary.review_counts.running;
    const value = {
      duration_ms: duration,
      finding_counts: monitor.summary.finding_counts,
      nodes: [
        {
          kind: "system",
          key: "preparing",
          label: "Preparing",
          status: preparingStatus(evaluation),
        },
        ...monitor.nodes,
        {
          kind: "system",
          key: "finalizing",
          label: "Finalizing",
          status: finalizingStatus(evaluation, activeReviewRuns),
        },
      ],
      outcome_counts: monitor.summary.outcome_counts,
      review_counts: monitor.summary.review_counts,
    };
    if (!validEvaluationMonitor(value)) {
      throw new TypeError("Evaluation monitor is invalid");
    }
    result.set(id, value);
  }
  return result;
}
