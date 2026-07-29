import { forbidMachineOperatorAccess } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

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
      "repository_not_found",
      "review_run_not_found",
    ].includes(code)
  ) {
    return 404;
  }
  if (
    [
      "evaluation_result_not_ready",
      "evaluation_not_cancellable",
      "idempotency_conflict",
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
    const evaluationMatch = path.match(/^\/api\/v1\/evaluations\/([^/]+)$/);
    if (
      !(
        (method === "GET" && path === "/api/v1/evaluations") ||
        (method === "POST" && createMatch) ||
        (method === "POST" && cancellationMatch) ||
        (method === "GET" && evaluationMatch) ||
        (method === "GET" && resultMatch) ||
        (method === "GET" && diagnosticsMatch)
      )
    ) {
      return false;
    }
    if (authority === "machine") {
      forbidMachineOperatorAccess(response, recordAuthorityAttribution);
      return true;
    }
    try {
      assertAllowedQueryParameters(
        requestUrl,
        method === "GET" && path === "/api/v1/evaluations"
          ? new Set(["cursor", "limit"])
          : new Set(),
      );
      if (method === "GET" && path === "/api/v1/evaluations") {
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
          evaluations.readResult(decodeURIComponent(resultMatch[1])),
        );
        return true;
      }
      if (method === "GET" && diagnosticsMatch) {
        writeJson(
          response,
          200,
          evaluations.readReviewRunDiagnostics(
            decodeURIComponent(diagnosticsMatch[1]),
            decodeURIComponent(diagnosticsMatch[2]),
          ),
        );
        return true;
      }
      if (method === "GET" && evaluationMatch) {
        writeJson(
          response,
          200,
          evaluations.read(decodeURIComponent(evaluationMatch[1])),
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
          evaluations.cancel(decodeURIComponent(cancellationMatch[1])),
        );
        return true;
      }
      const idempotencyKey = request.headers["idempotency-key"];
      const created = await evaluations.createExplicit({
        channel: "browser_session",
        idempotencyKey,
        repositoryId: decodeURIComponent(
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
