import { forbidMachineOperatorAccess } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

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
  const evaluationMatch = path.match(/^\/api\/v1\/evaluations\/([^/]+)$/);
  const collection = method === "GET" && path === "/api/v1/evaluations";
  const readable =
    method === "GET" &&
    (evaluationMatch !== null ||
      resultMatch !== null ||
      reviewRunMatch !== null ||
      findingMatch !== null);
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
          waiverBatchMatch !== null ||
          waiverErrorRetryMatch !== null)) ||
      (method === "GET" && diagnosticsMatch !== null),
    resultMatch,
    reviewRunMatch,
    waiverBatchMatch,
    waiverErrorRetryMatch,
  };
}

/** @param {Error & {code: string, unavailable?: boolean}} failure */
function failureStatus(failure) {
  const { code } = failure;
  if (code === "authentication_required") {
    return 401;
  }
  if (["csrf_invalid", "origin_invalid"].includes(code)) {
    return 403;
  }
  if (
    [
      "cursor_invalid",
      "idempotency_key_required",
      "page_size_invalid",
      "request_malformed",
    ].includes(code)
  ) {
    return 400;
  }
  if (
    [
      "evaluation_not_found",
      "finding_not_found",
      "repository_not_found",
      "review_run_not_found",
      "waiver_request_not_found",
    ].includes(code)
  ) {
    return 404;
  }
  if (
    [
      "evaluation_result_not_ready",
      "evaluation_not_cancellable",
      "idempotency_conflict",
      "waiver_adjudication_active",
      "waiver_finding_ineligible",
      "waiver_error_retry_ineligible",
      "waiver_request_accepted",
      "waiver_request_decision_required",
      "waiver_request_error_retry_required",
      "waiver_request_duplicate",
      "waiver_request_limit_reached",
      "repository_disabled",
      "repository_not_enabled",
      "repository_retired",
    ].includes(code)
  ) {
    return 409;
  }
  if (
    [
      "evaluation_git_acquisition_failed",
      "evaluation_git_acquisition_unavailable",
      "capacity_unavailable",
      "repository_authentication_failed",
      "repository_git_credentials_unavailable",
      "repository_git_read_failed",
      "repository_permission_denied",
      "review_run_admission_unavailable",
      "storage_reserve_check_failed",
      "storage_reserve_unavailable",
      "waiver_adjudicator_configuration_required",
    ].includes(code) ||
    failure.unavailable === true ||
    isUnavailableError(failure)
  ) {
    return 503;
  }
  return 422;
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
      reviewRunMatch,
      waiverBatchMatch,
      waiverErrorRetryMatch,
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
        failureStatus(failure),
        failure.code,
        failure.message,
      );
      return true;
    }
  };
}
