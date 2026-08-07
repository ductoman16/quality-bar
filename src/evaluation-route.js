import { forbidMachineOperatorAccess } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import { evaluationFailureStatus } from "./evaluation-route-failure.js";
import {
  assertAllowedQueryParameters,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";
import { writeWaiverRecovery } from "./waiver-recovery-route.js";

/** @param {string} segment */
export function decodeEvaluationPathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new Error("request_malformed");
  }
}

/** @param {string | undefined} method @param {string} path */
export function matchEvaluationRoute(method, path) {
  const createMatch = path.match(
    /^\/api\/v1\/repositories\/([^/]+)\/evaluations$/,
  );
  const resultMatch = path.match(/^\/api\/v1\/evaluations\/([^/]+)\/result$/);
  const cancellationMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/cancel$/,
  );
  const preStartRetryMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/retry$/,
  );
  const diagnosticsMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/review-runs\/([^/]+)\/diagnostics$/,
  );
  const reviewRunMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/review-runs\/([^/]+)$/,
  );
  const findingMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/findings\/([^/]+)$/,
  );
  const waiverBatchMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/waiver-adjudications$/,
  );
  const waiverErrorRetryMatch = path.match(
    /^\/api\/v1\/evaluations\/([^/]+)\/waiver-adjudications\/error-retries$/,
  );
  const waiverRequestMatch = path.match(
    /^\/api\/v1\/waiver-requests\/([^/]+)$/,
  );
  const waiverAdjudicationMatch = path.match(
    /^\/api\/v1\/waiver-adjudications\/([^/]+)$/,
  );
  const waiverDecisionMatch = path.match(
    /^\/api\/v1\/waiver-decisions\/([^/]+)$/,
  );
  const waiverRecoveryMatch = path.match(
    /^\/api\/v1\/waiver-adjudications\/([^/]+)\/recover$/,
  );
  const evaluationMatch = path.match(/^\/api\/v1\/evaluations\/([^/]+)$/);
  const collection = method === "GET" && path === "/api/v1/evaluations";
  const readable =
    method === "GET" &&
    (evaluationMatch !== null ||
      resultMatch !== null ||
      reviewRunMatch !== null ||
      findingMatch !== null ||
      waiverRequestMatch !== null ||
      waiverAdjudicationMatch !== null ||
      waiverDecisionMatch !== null ||
      waiverBatchMatch !== null);
  return {
    cancellationMatch,
    collection,
    createMatch,
    diagnosticsMatch,
    evaluationMatch,
    findingMatch,
    machineAccessible:
      collection ||
      readable ||
      (method === "POST" && Boolean(createMatch || waiverBatchMatch)),
    recognized:
      collection ||
      readable ||
      (method === "POST" &&
        (createMatch !== null ||
          cancellationMatch !== null ||
          preStartRetryMatch !== null ||
          waiverBatchMatch !== null ||
          waiverErrorRetryMatch !== null ||
          waiverRecoveryMatch !== null)) ||
      (method === "GET" && diagnosticsMatch !== null),
    resultMatch,
    preStartRetryMatch,
    reviewRunMatch,
    waiverAdjudicationMatch,
    waiverBatchMatch,
    waiverDecisionMatch,
    waiverErrorRetryMatch,
    waiverRequestMatch,
    waiverRecoveryMatch,
  };
}

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   evaluations: ReturnType<typeof import("./evaluation.js").createEvaluationService>,
 *   recordAuthorityAttribution: (event: {action: string, channel: string, errorCode?: string, outcome: string}) => void
 * }} dependencies
 */
export function createEvaluationRoute({
  browserOrigin,
  browserSessions,
  evaluations,
  recordAuthorityAttribution,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   * @param {"callback" | "machine" | "operator" | undefined} authority
   */
  return async function handleEvaluation(
    request,
    response,
    requestUrl,
    authority,
  ) {
    const { method } = request;
    const path = requestUrl.pathname;
    const matches = matchEvaluationRoute(method, path);
    const {
      cancellationMatch,
      collection,
      createMatch,
      diagnosticsMatch,
      evaluationMatch,
      findingMatch,
      resultMatch,
      preStartRetryMatch,
      reviewRunMatch,
      waiverAdjudicationMatch,
      waiverBatchMatch,
      waiverDecisionMatch,
      waiverErrorRetryMatch,
      waiverRequestMatch,
      waiverRecoveryMatch,
    } = matches;
    if (!matches.recognized) {
      return false;
    }
    if (authority === "machine" && !matches.machineAccessible) {
      forbidMachineOperatorAccess(response, recordAuthorityAttribution);
      return true;
    }
    try {
      assertAllowedQueryParameters(
        requestUrl,
        collection ? new Set(["cursor", "limit"]) : new Set(),
      );
      if (collection) {
        writeJson(
          response,
          200,
          evaluations.list({
            cursor: requestUrl.searchParams.get("cursor") ?? undefined,
            limit: requestUrl.searchParams.get("limit") ?? undefined,
          }),
        );
        return true;
      }
      if (method === "GET" && resultMatch) {
        writeJson(
          response,
          200,
          evaluations.readResult(decodeEvaluationPathSegment(resultMatch[1])),
        );
        return true;
      }
      if (method === "GET" && waiverBatchMatch) {
        writeJson(
          response,
          200,
          evaluations.readWaiverAdjudications(
            decodeEvaluationPathSegment(waiverBatchMatch[1]),
          ),
        );
        return true;
      }
      if (method === "GET" && diagnosticsMatch) {
        writeJson(
          response,
          200,
          evaluations.readReviewRunDiagnostics(
            decodeEvaluationPathSegment(diagnosticsMatch[1]),
            decodeEvaluationPathSegment(diagnosticsMatch[2]),
          ),
        );
        return true;
      }
      if (method === "GET" && reviewRunMatch) {
        writeJson(
          response,
          200,
          evaluations.readReviewRun(
            decodeEvaluationPathSegment(reviewRunMatch[1]),
            decodeEvaluationPathSegment(reviewRunMatch[2]),
          ),
        );
        return true;
      }
      if (method === "GET" && findingMatch) {
        writeJson(
          response,
          200,
          evaluations.readFinding(
            decodeEvaluationPathSegment(findingMatch[1]),
            decodeEvaluationPathSegment(findingMatch[2]),
          ),
        );
        return true;
      }
      if (method === "GET" && evaluationMatch) {
        writeJson(
          response,
          200,
          evaluations.read(decodeEvaluationPathSegment(evaluationMatch[1])),
        );
        return true;
      }
      if (method === "GET" && waiverRequestMatch) {
        writeJson(
          response,
          200,
          evaluations.readWaiverRequest(
            decodeEvaluationPathSegment(waiverRequestMatch[1]),
          ),
        );
        return true;
      }
      if (method === "GET" && waiverAdjudicationMatch) {
        writeJson(
          response,
          200,
          evaluations.readWaiverAdjudication(
            decodeEvaluationPathSegment(waiverAdjudicationMatch[1]),
          ),
        );
        return true;
      }
      if (method === "GET" && waiverDecisionMatch) {
        writeJson(
          response,
          200,
          evaluations.readWaiverDecision(
            decodeEvaluationPathSegment(waiverDecisionMatch[1]),
          ),
        );
        return true;
      }
      if (authority === "operator") {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
      }
      if (cancellationMatch) {
        writeJson(
          response,
          200,
          evaluations.cancel(decodeEvaluationPathSegment(cancellationMatch[1])),
        );
        return true;
      }
      if (preStartRetryMatch) {
        const retried = evaluations.retryPreStart({
          channel:
            authority === "machine" ? "implementer_token" : "browser_session",
          evaluationId: decodeEvaluationPathSegment(preStartRetryMatch[1]),
          idempotencyKey: request.headers["idempotency-key"],
        });
        writeJson(response, retried.status, retried.resource);
        return true;
      }
      if (waiverBatchMatch) {
        const created = evaluations.submitWaiverBatch({
          channel:
            authority === "machine" ? "implementer_token" : "browser_session",
          evaluationId: decodeEvaluationPathSegment(waiverBatchMatch[1]),
          idempotencyKey: request.headers["idempotency-key"],
          request: await readJsonRequest(request),
        });
        writeJson(response, created.status, created.resource, {
          location: `/api/v1/waiver-adjudications/${encodeURIComponent(
            created.resource.adjudication.id,
          )}`,
        });
        return true;
      }
      if (waiverErrorRetryMatch) {
        const created = evaluations.retryWaiverErrors({
          channel: "browser_session",
          evaluationId: decodeEvaluationPathSegment(waiverErrorRetryMatch[1]),
          idempotencyKey: request.headers["idempotency-key"],
          request: await readJsonRequest(request),
        });
        writeJson(response, created.status, created.resource, {
          location: `/api/v1/waiver-adjudications/${encodeURIComponent(
            created.resource.adjudication.id,
          )}`,
        });
        return true;
      }
      if (waiverRecoveryMatch) {
        writeWaiverRecovery(
          response,
          evaluations,
          decodeEvaluationPathSegment(waiverRecoveryMatch[1]),
          request.headers["idempotency-key"],
        );
        return true;
      }
      const idempotencyKey = request.headers["idempotency-key"];
      const created = await evaluations.createExplicit({
        channel:
          authority === "machine" ? "implementer_token" : "browser_session",
        idempotencyKey,
        repositoryId: decodeEvaluationPathSegment(
          /** @type {RegExpMatchArray} */ (createMatch)[1],
        ),
        request: await readJsonRequest(request),
      });
      writeJson(
        response,
        /** @type {number} */ (created.status),
        created.resource,
        {
          location: `/api/v1/evaluations/${encodeURIComponent(created.resource.id)}`,
        },
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "request_malformed") {
        writeError(response, 400, "request_malformed", "Request is malformed");
        return true;
      }
      const failure = requireCodedError(error);
      writeError(
        response,
        evaluationFailureStatus(failure),
        failure.code,
        failure.message,
      );
      return true;
    }
  };
}
