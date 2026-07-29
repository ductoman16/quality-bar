import { createHash, randomUUID } from "node:crypto";
import { createEvaluationCollection } from "./evaluation-collection.js";
import {
  cancelEvaluation,
  signalReviewRunCancellations,
} from "./evaluation-cancellation.js";
import { withAcquiredChangeset } from "./evaluation-changeset.js";
import { requireFrozenChangeset } from "./evaluation-changeset-validation.js";
import { readIdempotentReplay } from "./evaluation-idempotency.js";
import { createEvaluationIdentity } from "./evaluation-identity.js";
import {
  canonicalExplicitEvaluationRequest,
  EvaluationError,
  failEvaluation,
  failEvaluationUnavailable,
  requireIdempotencyKey,
} from "./evaluation-validation.js";
import { isUniqueConstraintFailure } from "./sqlite-error.js";
import { createEvaluationResultResourceReader } from "./evaluation-result-resource.js";
import { createEvaluationReviewRunDiagnosticsReader } from "./evaluation-review-run-diagnostics.js";
import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";
import {
  enqueueReviewRuns,
  insertApplicabilityResults,
  sealApplicabilityResults,
  selectReviewRunsForAdmission,
} from "./review-run-admission.js";

export { EvaluationError };
export { createUnavailableEvaluationService } from "./evaluation-unavailable.js";

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
 *   acquireChangeset: (repositoryId: string, request: ReturnType<typeof canonicalExplicitEvaluationRequest>) => Promise<{base_commit: string, head_commit: string, file_changes?: unknown, matches_path?: (pathspec: string, path: string) => boolean, read_content?: (fileChange: any, side: "before" | "after") => any}>,
 *   readCodexCapabilityFailure: () => (Error & {code: string}) | null,
 *   createId?: () => string,
 *   createReviewRunId?: () => string,
 *   masterKey: Buffer,
 *   now?: () => number,
 *   signalCancellations?: (workIds: string[]) => void,
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
    signalCancellations = signalReviewRunCancellations,
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
    typeof signalCancellations !== "function" ||
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

  const resultResources = createEvaluationResultResourceReader(durableCore);

  /**
   * @param {any} transaction
   * @param {{
   *   changeset: any,
   *   identity?: {createdAt: number, evaluationId: string},
   *   provenance: "automatic" | "explicit",
   *   pullRequestNumber?: number,
   *   repositoryId: string,
   *   selectors: {base: {type: "branch" | "commit", value: string}, head: {type: "branch" | "commit", value: string}}
   * }} input
   */
  function admitFrozenEvaluation(transaction, input) {
    const {
      changeset,
      identity,
      provenance,
      pullRequestNumber,
      repositoryId,
      selectors,
    } = input;
    requireFrozenChangeset(changeset);
    if (provenance === "automatic") {
      if (
        !Number.isSafeInteger(pullRequestNumber) ||
        /** @type {number} */ (pullRequestNumber) <= 0
      ) {
        throw new TypeError("Automatic Evaluation provenance is invalid");
      }
      const existing = transaction.get(
        `SELECT evaluation_id FROM github_automatic_evaluations
          WHERE repository_id = ? AND base_commit = ? AND head_commit = ?`,
        repositoryId,
        changeset.base_commit,
        changeset.head_commit,
      );
      if (existing) {
        const row = transaction.get(
          `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
          existing.evaluation_id,
        );
        return {
          createdAt: row.created_at,
          evaluationId: existing.evaluation_id,
          resource: readEvaluation(row),
        };
      }
      storageReserve.assertWorkAdmissionAvailable();
    }
    const { createdAt, evaluationId } =
      identity ?? createEvaluationIdentity(createId, now);
    if (
      typeof evaluationId !== "string" ||
      evaluationId.length === 0 ||
      !Number.isSafeInteger(createdAt)
    ) {
      throw new TypeError("Evaluation identity or timestamp is invalid");
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
    const { applicabilityResults, reviewRuns } = selectReviewRunsForAdmission(
      transaction,
      repositoryId,
      createReviewRunId,
      readCodexCapabilityFailure,
      changeset,
      typeof changeset.matches_path === "function"
        ? changeset.matches_path
        : () => {
            throw Object.assign(
              new Error("Frozen Git path matching is unavailable"),
              { code: "applicability_path_matching_unavailable" },
            );
          },
      changeset.read_content,
    );
    const executionStatus = reviewRuns.length === 0 ? "completed" : "queued";
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
      selectors.base.type,
      selectors.base.value,
      selectors.head.type,
      selectors.head.value,
      changeset.base_commit,
      changeset.head_commit,
      executionStatus,
      createdAt,
      completedAt,
    );
    if (provenance === "automatic") {
      transaction.run(
        `INSERT INTO github_automatic_evaluations (
           evaluation_id, repository_id, pull_request_number,
           base_commit, head_commit
         ) VALUES (?, ?, ?, ?, ?)`,
        evaluationId,
        repositoryId,
        pullRequestNumber,
        changeset.base_commit,
        changeset.head_commit,
      );
    }
    insertApplicabilityResults(transaction, evaluationId, applicabilityResults);
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
    return {
      createdAt,
      evaluationId,
      resource: readEvaluation(
        transaction.get(
          `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
          evaluationId,
        ),
      ),
    };
  }

  return {
    /**
     * @param {any} transaction
     * @param {{changeset: any, pullRequestNumber: number, repositoryId: string}} input
     */
    admitAutomatic(transaction, input) {
      if (
        !transaction ||
        typeof transaction.get !== "function" ||
        typeof transaction.run !== "function" ||
        typeof input?.repositoryId !== "string" ||
        input.repositoryId.length === 0
      ) {
        throw new TypeError("Automatic Evaluation admission is invalid");
      }
      return admitFrozenEvaluation(transaction, {
        ...input,
        provenance: "automatic",
        selectors: {
          base: { type: "commit", value: input.changeset?.base_commit },
          head: { type: "commit", value: input.changeset?.head_commit },
        },
      }).resource;
    },
    /** @param {string} id */
    cancel(id) {
      cancelEvaluation(
        durableCore,
        id,
        now,
        signalCancellations,
        failEvaluation,
      );
      return read(id);
    },
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
    ...resultResources,
    readReviewRunDiagnostics:
      createEvaluationReviewRunDiagnosticsReader(durableCore),
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
      const route =
        channel === "mcp"
          ? "quality_bar.request_evaluation"
          : `/api/v1/repositories/${repositoryId}/evaluations`;
      const idempotentRequest =
        channel === "mcp"
          ? { repository_id: repositoryId, ...canonicalRequest }
          : canonicalRequest;
      const requestHash = createHash("sha256")
        .update(JSON.stringify(idempotentRequest))
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
      return withAcquiredChangeset(
        acquireChangeset,
        repositoryId,
        canonicalRequest,
        (commits, releaseChangeset) => {
          requireFrozenChangeset(commits);
          const identity = createEvaluationIdentity(createId, now);
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
              const { createdAt, evaluationId, resource } =
                admitFrozenEvaluation(transaction, {
                  changeset: commits,
                  identity,
                  provenance: "explicit",
                  repositoryId,
                  selectors: /** @type {any} */ (canonicalRequest),
                });
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
              releaseChangeset();
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
      );
    },
  };
}
