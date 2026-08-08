import { createEvaluationCollection } from "./evaluation-collection.js";
import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";
import { readEvaluationMonitors } from "./evaluation-monitor.js";
import { failEvaluation } from "./evaluation-validation.js";

/**
 * @param {{all: Function, get: Function}} durableCore
 * @param {Buffer} masterKey
 */
export function createEvaluationCollectionReader(durableCore, masterKey) {
  const collection = createEvaluationCollection(
    masterKey,
    ({ after, filters, limit }) => {
      const conditions = [];
      const parameters = [];
      if (filters.repository_id !== null) {
        conditions.push("repository_id = ?");
        parameters.push(filters.repository_id);
      }
      if (filters.execution_status !== null) {
        conditions.push("execution_status = ?");
        parameters.push(filters.execution_status);
      }
      if (filters.effective_outcome !== null) {
        conditions.push(`CASE
          WHEN active_waiver_adjudication_count > 0 OR result_outcome IS NULL
            THEN 'pending'
          WHEN current_waiver_error_count > 0 OR result_outcome = 'error'
            THEN 'error'
          WHEN blocking_finding_count > 0 THEN 'blocking'
          WHEN unwaived_advisory_finding_count > 0 THEN 'advisory'
          ELSE 'clear'
        END = ?`);
        parameters.push(filters.effective_outcome);
      }
      if (filters.start !== null) {
        conditions.push("created_at >= ?");
        parameters.push(filters.start);
      }
      if (filters.end !== null) {
        conditions.push("created_at < ?");
        parameters.push(filters.end);
      }
      if (filters.query !== null) {
        conditions.push(`(
          lower(repository_id) LIKE '%' || lower(?) || '%'
          OR lower(normalized_url) LIKE '%' || lower(?) || '%'
          OR lower(base_selector_value) LIKE '%' || lower(?) || '%'
          OR lower(head_selector_value) LIKE '%' || lower(?) || '%'
          OR lower(base_commit) LIKE lower(?) || '%'
          OR lower(head_commit) LIKE lower(?) || '%'
          OR (
            ? = 1
            AND automatic_pull_request_number = ?
          )
        )`);
        const pullRequestNumber =
          /^[0-9]+$/.test(filters.query) &&
          Number.isSafeInteger(Number(filters.query))
            ? Number(filters.query)
            : null;
        parameters.push(
          filters.query,
          filters.query,
          filters.query,
          filters.query,
          filters.query,
          filters.query,
          pullRequestNumber === null ? 0 : 1,
          pullRequestNumber,
        );
      }
      if (after) {
        conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
        parameters.push(after.created_at, after.created_at, after.id);
      }
      return durableCore.all(
        `SELECT * FROM (${EVALUATION_SELECTION})
         ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        ...parameters,
        limit,
      );
    },
  );

  /**
   * @param {(Record<string, import("node:sqlite").SQLInputValue> | undefined)[]} rows
   */
  function serialize(rows) {
    const monitors = readEvaluationMonitors(durableCore, rows);
    return rows.map((row) => {
      if (!row || typeof row.id !== "string") {
        throw new TypeError("Evaluation collection row is invalid");
      }
      const monitor = monitors.get(row.id);
      if (!monitor) {
        throw new TypeError("Evaluation monitor is missing");
      }
      return readEvaluation(row, monitor);
    });
  }

  /** @param {string} id */
  function read(id) {
    const row = durableCore.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      id,
    );
    if (!row) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    return serialize([row])[0];
  }

  return { collection, read, serialize };
}
