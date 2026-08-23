import { createHash, randomUUID } from "node:crypto";
import { createEvaluationCollectionReader } from "./evaluation-collection-reader.js";
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
import { isUniqueConstraintFailure } from "../sqlite-error.js";
import {
  prepareAutomaticEvaluation,
  recordAutomaticEvaluation,
} from "../automatic-evaluation-provider.js";
import { createEvaluationResultResourceReader } from "./evaluation-result-resource.js";
import { createEvaluationReviewRunDiagnosticsReader } from "./evaluation-review-run-diagnostics.js";
import {
  EVALUATION_SELECTION,
  readEvaluationWithMonitor,
} from "./evaluation-resource.js";
import {
  enqueueReviewRuns,
  insertApplicabilityResults,
  sealApplicabilityResults,
  selectReviewRunsForAdmission,
} from "../review/review-run-admission.js";
import { createWaiverBatchService } from "../waiver/waiver-batch.js";
import { createWaiverResourceReader } from "../waiver/waiver-resource.js";
import { readEvaluationWaiverAdjudications } from "../waiver/waiver-adjudication-resource.js";
import { createAnalyticsService } from "../analytics/analytics.js";
import { createEvaluationPreStartRetryService } from "./evaluation-pre-start-retry.js";
import { createAutomaticEvaluationAdmission } from "./evaluation-automatic-admission.js";
import { readLiveCodexCapabilityFailure as readCapabilityFailure } from "../codex/codex-capability-gate.js";

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
 *   createWaiverAdjudicationId?: () => string,
 *   createWaiverRequestId?: () => string,
 *   masterKey: Buffer,
 *   now?: () => number,
 *   signalCancellations?: (workIds: string[]) => void,
 *   storageReserve: {assertWorkAdmissionAvailable: () => unknown},
 *   validateCodexAuthentication?: () => unknown
 * }} options
 */
export function createEvaluationService(
  durableCore,
  {
    acquireChangeset,
    readCodexCapabilityFailure,
    createId = randomUUID,
    createReviewRunId = randomUUID,
    createWaiverAdjudicationId = () => randomUUID(),
    createWaiverRequestId = () => randomUUID(),
    masterKey,
    now = () => Date.now(),
    signalCancellations = signalReviewRunCancellations,
    storageReserve,
    validateCodexAuthentication = () => {},
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
    typeof storageReserve?.assertWorkAdmissionAvailable !== "function" ||
    typeof validateCodexAuthentication !== "function"
  ) {
    throw new TypeError("Evaluation dependencies are invalid");
  }
  const { collection, read, serialize } = createEvaluationCollectionReader(
    durableCore,
    masterKey,
  );
  const readLiveCodexCapabilityFailure = () =>
    readCapabilityFailure(
      readCodexCapabilityFailure(),
      validateCodexAuthentication,
    );

  const resultResources = createEvaluationResultResourceReader(durableCore);
  const waiverBatches = createWaiverBatchService(durableCore, {
    createAdjudicationId: createWaiverAdjudicationId,
    createRequestId: createWaiverRequestId,
    now,
    readCodexCapabilityFailure: readLiveCodexCapabilityFailure,
    storageReserve,
  });
  const waiverResources = createWaiverResourceReader(durableCore);
  const analytics = createAnalyticsService(durableCore, { now });
  const preStartRetries = createEvaluationPreStartRetryService(durableCore, {
    now,
    readCodexCapabilityFailure: readLiveCodexCapabilityFailure,
    storageReserve,
  });

  /**
   * @param {any} transaction
   * @param {{
   *   changeset: any,
   *   identity?: {createdAt: number, evaluationId: string},
   *   provenance: "automatic" | "explicit",
   *   provider?: "forgejo" | "github",
   *   pullRequestNumber?: number,
   *   repositoryId: string,
   *   selectors: {base: {type: "branch" | "commit", value: string}, head: {type: "branch" | "commit", value: string}}
   * }} input
   */
  function admitFrozenEvaluation(transaction, input) {
    const { changeset, identity, provenance, repositoryId, selectors } = input;
    /** @type {string[]} */
    const cancelledRunningReviewRunIds = [];
    requireFrozenChangeset(changeset);
    if (provenance === "automatic") {
      const automatic = prepareAutomaticEvaluation(
        transaction,
        input,
        now,
        failEvaluation,
      );
      cancelledRunningReviewRunIds.push(
        ...automatic.cancelledRunningReviewRunIds,
      );
      if (automatic.existing) {
        return {
          cancelledRunningReviewRunIds,
          ...automatic.existing,
        };
      }
    }
    storageReserve.assertWorkAdmissionAvailable();
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
      readLiveCodexCapabilityFailure,
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
      recordAutomaticEvaluation(transaction, evaluationId, input);
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
      cancelledRunningReviewRunIds,
      createdAt,
      evaluationId,
      resource: readEvaluationWithMonitor(
        transaction,
        transaction.get(
          `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
          evaluationId,
        ),
      ),
    };
  }

  return {
    admitAutomatic: createAutomaticEvaluationAdmission(
      admitFrozenEvaluation,
      signalCancellations,
    ),
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
    /**
     * @param {{
     *   cursor?: string,
     *   effective_outcome?: string,
     *   end?: string,
     *   execution_status?: string,
     *   limit?: string,
     *   query?: string,
     *   repository_id?: string,
     *   start?: string
     * }} [query]
     */
    list(query = {}) {
      const page = collection.read(query);
      return {
        items: serialize(page.items),
        next_cursor: page.next_cursor,
      };
    },
    read,
    /**
     * @param {{
     *   channel: "browser_session" | "implementer_token" | "mcp",
     *   evaluationId: string,
     *   idempotencyKey: unknown
     * }} input
     */
    retryPreStart({ channel, evaluationId, idempotencyKey }) {
      const retried = preStartRetries.retry({
        channel,
        evaluationId,
        idempotencyKey,
      });
      return retried;
    },
    readAnalytics: analytics.read,
    /** @param {string} id */
    readWaiverAdjudications(id) {
      read(id);
      return { items: readEvaluationWaiverAdjudications(durableCore, id) };
    },
    recoverWaiverAdjudication: waiverBatches.recoverAdjudication,
    retryWaiverErrors: waiverBatches.retryErrors,
    submitWaiverBatch: waiverBatches.submit,
    readWaiverAdjudication: waiverResources.readAdjudication,
    readWaiverDecision: waiverResources.readDecision,
    readWaiverRequest: waiverResources.readRequest,
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
