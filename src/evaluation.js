import { createHash, randomUUID } from "node:crypto";

import { createEvaluationCollection } from "./evaluation-collection.js";
import {
  canonicalExplicitEvaluationRequest,
  EvaluationError,
  failEvaluation,
  failEvaluationUnavailable,
  requireIdempotencyKey,
} from "./evaluation-validation.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";
import { readCompletedEvaluationResult } from "./evaluation-result-read.js";
import {
  enqueueReviewRuns,
  insertApplicabilityResults,
  sealApplicabilityResults,
  selectReviewRunsForAdmission,
} from "./review-run-admission.js";

export { EvaluationError };
const ROUTE_PREFIX = "/api/v1/repositories/";

const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
function readEvaluation(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.repository_id !== "string" ||
    typeof row.normalized_url !== "string" ||
    typeof row.base_selector_type !== "string" ||
    typeof row.base_selector_value !== "string" ||
    typeof row.head_selector_type !== "string" ||
    typeof row.head_selector_value !== "string" ||
    typeof row.base_commit !== "string" ||
    typeof row.head_commit !== "string" ||
    typeof row.execution_status !== "string" ||
    !(
      row.next_attempt_at === null || Number.isSafeInteger(row.next_attempt_at)
    ) ||
    !Number.isSafeInteger(row.created_at)
  ) {
    throw new TypeError("Evaluation row is invalid");
  }
  const completedAt =
    row.completed_at === null ? null : /** @type {number} */ (row.completed_at);
  const outcome =
    row.result_outcome === null
      ? "pending"
      : /** @type {string} */ (row.result_outcome);
  return {
    base_commit: row.base_commit,
    base_selector: {
      type: row.base_selector_type,
      value: row.base_selector_value,
    },
    completed_at: completedAt === null ? null : timestamp(completedAt),
    created_at: timestamp(/** @type {number} */ (row.created_at)),
    effective_outcome: outcome,
    execution_status: row.execution_status,
    head_commit: row.head_commit,
    head_selector: {
      type: row.head_selector_type,
      value: row.head_selector_value,
    },
    id: row.id,
    next_attempt_at:
      row.next_attempt_at === null
        ? null
        : timestamp(/** @type {number} */ (row.next_attempt_at)),
    provenance: "explicit",
    repository: { id: row.repository_id, url: row.normalized_url },
  };
}

const EVALUATION_SELECTION = `SELECT evaluations.*, repositories.normalized_url,
  evaluation_results.outcome AS result_outcome FROM evaluations
  JOIN repositories ON repositories.id = evaluations.repository_id
  LEFT JOIN evaluation_results ON evaluation_results.evaluation_id = evaluations.id`;

/**
 * @param {{get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined}} access
 * @param {string} channel
 * @param {string} route
 * @param {string} key
 * @param {string} requestHash
 */
function readIdempotentReplay(access, channel, route, key, requestHash) {
  const replay = access.get(
    `SELECT request_hash, response_status, response_body
     FROM evaluation_idempotency
     WHERE channel = ? AND route = ? AND idempotency_key = ?`,
    channel,
    route,
    key,
  );
  if (!replay) {
    return null;
  }
  if (replay.request_hash !== requestHash) {
    failEvaluation(
      "idempotency_conflict",
      "Idempotency key was already used with different input",
    );
  }
  return {
    resource: JSON.parse(/** @type {string} */ (replay.response_body)),
    status: replay.response_status,
  };
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   transaction<Result>(callback: (transaction: {
 *     all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *     get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {{
 *   acquireChangeset: (repositoryId: string, request: ReturnType<typeof canonicalExplicitEvaluationRequest>) => Promise<{base_commit: string, head_commit: string, file_changes?: unknown, matches_path?: (pathspec: string, path: string) => boolean}>,
 *   readCodexCapabilityFailure: () => (Error & {code: string}) | null,
 *   createId?: () => string,
 *   createReviewRunId?: () => string,
 *   masterKey: Buffer,
 *   now?: () => number,
 *   storageReserve: {assertWorkAdmissionAvailable: () => unknown}
 * }} options
 */
export function createEvaluationService(
  durableCore,
  {
    acquireChangeset,
    readCodexCapabilityFailure,
    createId = randomUUID,
    createReviewRunId = randomUUID,
    masterKey,
    now = () => Date.now(),
    storageReserve,
  },
) {
  if (
    typeof durableCore?.transaction !== "function" ||
    typeof acquireChangeset !== "function" ||
    typeof readCodexCapabilityFailure !== "function" ||
    typeof createId !== "function" ||
    typeof createReviewRunId !== "function" ||
    !Buffer.isBuffer(masterKey) ||
    masterKey.length !== 32 ||
    typeof now !== "function" ||
    typeof storageReserve?.assertWorkAdmissionAvailable !== "function"
  ) {
    throw new TypeError("Evaluation dependencies are invalid");
  }
  const collection = createEvaluationCollection(masterKey, ({ after, limit }) =>
    durableCore.all(
      `${EVALUATION_SELECTION}
         ${
           after
             ? `WHERE evaluations.created_at < ?
                  OR (
                    evaluations.created_at = ?
                    AND evaluations.id < ?
                  )`
             : ""
         }
         ORDER BY evaluations.created_at DESC, evaluations.id DESC
         LIMIT ?`,
      ...(after
        ? [after.created_at, after.created_at, after.id, limit]
        : [limit]),
    ),
  );

  /** @param {string} id */
  function read(id) {
    const row = durableCore.get(
      `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
      id,
    );
    if (!row) {
      failEvaluation("evaluation_not_found", "Evaluation was not found");
    }
    return readEvaluation(row);
  }

  return {
    destroy() {
      collection.destroy();
    },
    /** @param {{cursor?: string, limit?: string}} [query] */
    list({ cursor, limit } = {}) {
      const page = collection.read({ cursor, limit });
      return {
        items: page.items.map(readEvaluation),
        next_cursor: page.next_cursor,
      };
    },
    read,
    /** @param {string} id */
    readResult(id) {
      const result = readCompletedEvaluationResult(durableCore, id);
      if (!result) {
        if (!durableCore.get("SELECT id FROM evaluations WHERE id = ?", id)) {
          failEvaluation("evaluation_not_found", "Evaluation was not found");
        }
        failEvaluation(
          "evaluation_result_not_ready",
          "Evaluation Result is not ready",
        );
      }
      return result;
    },
    /**
     * @param {{
     *   channel: "browser_session" | "implementer_token" | "mcp",
     *   idempotencyKey: unknown,
     *   repositoryId: string,
     *   request: unknown
     * }} input
     */
    async createExplicit({ channel, idempotencyKey, repositoryId, request }) {
      if (
        !["browser_session", "implementer_token", "mcp"].includes(channel) ||
        typeof repositoryId !== "string" ||
        repositoryId.length === 0
      ) {
        throw new TypeError("Evaluation creation identity is invalid");
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const canonicalRequest = canonicalExplicitEvaluationRequest(request);
      const route = `${ROUTE_PREFIX}${repositoryId}/evaluations`;
      const requestHash = createHash("sha256")
        .update(JSON.stringify(canonicalRequest))
        .digest("hex");
      const replay = readIdempotentReplay(
        durableCore,
        channel,
        route,
        key,
        requestHash,
      );
      if (replay) {
        return replay;
      }

      storageReserve.assertWorkAdmissionAvailable();
      const commits = await acquireChangeset(repositoryId, canonicalRequest);
      if (
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commits?.base_commit) ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commits?.head_commit) ||
        commits.base_commit.length !== commits.head_commit.length
      ) {
        throw new TypeError("Acquired Evaluation commits are invalid");
      }
      const evaluationId = createId();
      const createdAt = now();
      if (
        typeof evaluationId !== "string" ||
        evaluationId.length === 0 ||
        !Number.isSafeInteger(createdAt)
      ) {
        throw new TypeError("Evaluation identity or timestamp is invalid");
      }
      try {
        return durableCore.transaction((transaction) => {
          const racedReplay = readIdempotentReplay(
            transaction,
            channel,
            route,
            key,
            requestHash,
          );
          if (racedReplay) {
            return racedReplay;
          }
          const repository = transaction.get(
            `SELECT lifecycle, health, health_error_code, health_error_message
             FROM repositories WHERE id = ?`,
            repositoryId,
          );
          if (!repository) {
            failEvaluation("repository_not_found", "Repository was not found");
          }
          if (repository.lifecycle !== "enabled") {
            failEvaluation(
              "repository_not_enabled",
              "Repository does not accept new work",
            );
          }
          if (repository.health !== "healthy") {
            failEvaluationUnavailable(
              /** @type {string} */ (repository.health_error_code),
              /** @type {string} */ (repository.health_error_message),
            );
          }
          const { applicabilityResults, reviewRuns } =
            selectReviewRunsForAdmission(
              transaction,
              repositoryId,
              createReviewRunId,
              readCodexCapabilityFailure,
              commits,
              typeof commits.matches_path === "function"
                ? commits.matches_path
                : () => {
                    throw Object.assign(
                      new Error("Frozen Git path matching is unavailable"),
                      { code: "applicability_path_matching_unavailable" },
                    );
                  },
            );
          const executionStatus =
            reviewRuns.length === 0 ? "completed" : "queued";
          const completedAt = reviewRuns.length === 0 ? createdAt : null;
          transaction.run(
            `INSERT INTO evaluations (
               id, repository_id, provenance,
               base_selector_type, base_selector_value,
               head_selector_type, head_selector_value,
               base_commit, head_commit, execution_status, next_attempt_at,
               created_at, completed_at
             ) VALUES (?, ?, 'explicit', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
            evaluationId,
            repositoryId,
            canonicalRequest.base.type,
            canonicalRequest.base.value,
            canonicalRequest.head.type,
            canonicalRequest.head.value,
            commits.base_commit,
            commits.head_commit,
            executionStatus,
            createdAt,
            completedAt,
          );
          insertApplicabilityResults(
            transaction,
            evaluationId,
            applicabilityResults,
          );
          sealApplicabilityResults(transaction, evaluationId, createdAt);
          if (reviewRuns.length === 0) {
            const outcome = applicabilityResults.some(
              (result) => result.outcome === "error",
            )
              ? "error"
              : "clear";
            transaction.run(
              `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
               VALUES (?, ?, ?)`,
              evaluationId,
              outcome,
              createdAt,
            );
          } else {
            enqueueReviewRuns(transaction, evaluationId, reviewRuns, createdAt);
          }
          const resource = readEvaluation(
            transaction.get(
              `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
              evaluationId,
            ),
          );
          const responseBody = JSON.stringify(resource);
          transaction.run(
            `INSERT INTO evaluation_idempotency (
               channel, route, idempotency_key, request_hash,
               response_status, response_body, evaluation_id, created_at
             ) VALUES (?, ?, ?, ?, 201, ?, ?, ?)`,
            channel,
            route,
            key,
            requestHash,
            responseBody,
            evaluationId,
            createdAt,
          );
          return { resource, status: 201 };
        });
      } catch (error) {
        if (error instanceof EvaluationError) {
          throw error;
        }
        if (
          isUniqueConstraintFailure(
            error,
            "evaluation_idempotency.channel, evaluation_idempotency.route, evaluation_idempotency.idempotency_key",
          )
        ) {
          const raced = readIdempotentReplay(
            durableCore,
            channel,
            route,
            key,
            requestHash,
          );
          if (raced) {
            return raced;
          }
        }
        if (
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
        ) {
          failEvaluation(error.code, error.message, error);
        }
        throw new Error("Evaluation persistence failed", {
          cause: error,
        });
      }
    },
  };
}

/** @param {unknown} error */
export function createUnavailableEvaluationService(error) {
  const failure =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? { code: error.code, message: error.message }
      : {
          code: "evaluation_capability_unavailable",
          message: "Evaluation capability is unavailable",
        };
  return {
    destroy() {},
    async createExplicit() {
      failEvaluation(failure.code, failure.message, error);
    },
    list() {
      failEvaluation(failure.code, failure.message, error);
    },
    read() {
      failEvaluation(failure.code, failure.message, error);
    },
    readResult() {
      failEvaluation(failure.code, failure.message, error);
    },
  };
}
