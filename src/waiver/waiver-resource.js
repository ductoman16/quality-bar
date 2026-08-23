import { failEvaluation } from "../evaluation/evaluation-validation.js";

const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {Record<string, any>} row */
export function readWaiverRequest(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.evaluation_id !== "string" ||
    typeof row.finding_id !== "string" ||
    typeof row.rationale !== "string" ||
    !Number.isSafeInteger(row.created_at)
  ) {
    throw new TypeError("Waiver Request row is invalid");
  }
  return {
    created_at: timestamp(row.created_at),
    evaluation_id: row.evaluation_id,
    finding_id: row.finding_id,
    id: row.id,
    rationale: row.rationale,
  };
}

/** @param {Record<string, any>} row */
export function readWaiverDecision(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.waiver_adjudication_id !== "string" ||
    typeof row.waiver_request_id !== "string" ||
    !["accepted", "denied", "error"].includes(row.outcome) ||
    !Number.isSafeInteger(row.created_at)
  ) {
    throw new TypeError("Waiver Decision row is invalid");
  }
  const errorDecision = row.outcome === "error";
  if (
    (errorDecision &&
      (typeof row.error_code !== "string" ||
        typeof row.error_detail !== "string" ||
        row.explanation !== null)) ||
    (!errorDecision &&
      (typeof row.explanation !== "string" ||
        row.error_code !== null ||
        row.error_detail !== null))
  ) {
    throw new TypeError("Waiver Decision row is invalid");
  }
  return {
    created_at: timestamp(row.created_at),
    ...(errorDecision
      ? { error: { code: row.error_code, detail: row.error_detail } }
      : { explanation: row.explanation }),
    id: row.id,
    outcome: row.outcome,
    request_id: row.waiver_request_id,
    waiver_adjudication_id: row.waiver_adjudication_id,
  };
}

/**
 * @param {{all(sql: string, ...parameters: any[]): Record<string, any>[]}} access
 * @param {Record<string, any>} row
 * @param {string[]} requestIds
 */
export function readWaiverAdjudication(access, row, requestIds) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.evaluation_id !== "string" ||
    typeof row.base_commit !== "string" ||
    typeof row.head_commit !== "string" ||
    typeof row.model !== "string" ||
    typeof row.reasoning_effort !== "string" ||
    typeof row.service_tier !== "string" ||
    !["queued", "running", "completed", "failed", "cancelled"].includes(
      row.execution_status,
    ) ||
    !Number.isSafeInteger(row.created_at) ||
    !(row.started_at === null || Number.isSafeInteger(row.started_at)) ||
    !(row.completed_at === null || Number.isSafeInteger(row.completed_at)) ||
    !Array.isArray(requestIds) ||
    requestIds.length === 0 ||
    requestIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new TypeError("Waiver Adjudication row is invalid");
  }
  const failed = row.execution_status === "failed";
  const cancelled = row.execution_status === "cancelled";
  if (
    (failed &&
      (typeof row.error_code !== "string" ||
        typeof row.error_detail !== "string")) ||
    (!failed && (row.error_code !== null || row.error_detail !== null))
  ) {
    throw new TypeError("Waiver Adjudication row is invalid");
  }
  const completed = row.execution_status === "completed";
  const decisions = completed
    ? access
        .all(
          `SELECT * FROM waiver_decisions
           WHERE waiver_adjudication_id = ?
           ORDER BY rowid`,
          row.id,
        )
        .map(readWaiverDecision)
    : undefined;
  if (completed && decisions?.length !== requestIds.length) {
    throw new TypeError("Waiver Adjudication Decision set is invalid");
  }
  return {
    base_commit: row.base_commit,
    completed_at:
      row.completed_at === null ? null : timestamp(row.completed_at),
    configuration: {
      model: row.model,
      reasoning_effort: row.reasoning_effort,
      service_tier: row.service_tier,
    },
    created_at: timestamp(row.created_at),
    ...(decisions === undefined ? {} : { decisions }),
    ...(failed
      ? { error: { code: row.error_code, detail: row.error_detail } }
      : cancelled
        ? {
            error: {
              code: "waiver_adjudication_cancelled",
              detail: "Waiver Adjudication was cancelled",
            },
          }
        : {}),
    evaluation_id: row.evaluation_id,
    execution_status: row.execution_status,
    head_commit: row.head_commit,
    id: row.id,
    request_ids: requestIds,
    started_at: row.started_at === null ? null : timestamp(row.started_at),
  };
}

/** @param {any} durableCore */
export function createWaiverResourceReader(durableCore) {
  /** @param {string} adjudicationId */
  function readAdjudication(adjudicationId) {
    const row = durableCore.get(
      "SELECT * FROM waiver_adjudications WHERE id = ?",
      adjudicationId,
    );
    if (!row) {
      failEvaluation(
        "waiver_adjudication_not_found",
        "Waiver Adjudication was not found",
      );
    }
    const requestIds = durableCore
      .all(
        `SELECT waiver_request_id
         FROM waiver_adjudication_requests
         WHERE waiver_adjudication_id = ?
         ORDER BY position`,
        adjudicationId,
      )
      .map(
        (
          /** @type {{waiver_request_id: string}} */ { waiver_request_id: id },
        ) => id,
      );
    return readWaiverAdjudication(durableCore, row, requestIds);
  }

  return {
    readAdjudication,
    /** @param {string} decisionId */
    readDecision(decisionId) {
      const row = durableCore.get(
        "SELECT * FROM waiver_decisions WHERE id = ?",
        decisionId,
      );
      if (!row) {
        failEvaluation(
          "waiver_decision_not_found",
          "Waiver Decision was not found",
        );
      }
      return readWaiverDecision(row);
    },
    /** @param {string} requestId */
    readRequest(requestId) {
      const row = durableCore.get(
        "SELECT * FROM waiver_requests WHERE id = ?",
        requestId,
      );
      if (!row) {
        failEvaluation(
          "waiver_request_not_found",
          "Waiver Request was not found",
        );
      }
      return readWaiverRequest(row);
    },
  };
}
