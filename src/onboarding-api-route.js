import { requireCodedError } from "./coded-error.js";
import {
  assertAllowedQueryParameters,
  bearerToken,
  browserMutationFailureStatus,
  isUnavailableError,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson, writeStatus } from "./http-response.js";

/** @param {string} segment */
function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw Object.assign(new Error("Request is malformed"), {
      code: "request_malformed",
    });
  }
}

/** @param {unknown} body */
function requireEmptyObject(body) {
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    Object.keys(body).length !== 0
  ) {
    throw Object.assign(new Error("request_malformed"), {
      code: "request_malformed",
    });
  }
}

/** @param {any} dependencies */
export function createOnboardingApiRoute({
  browserOrigin,
  browserSessions,
  onboardingTokens,
  operations,
}) {
  return async function handleOnboardingApi(
    /** @type {import("node:http").IncomingMessage} */ request,
    /** @type {import("node:http").ServerResponse} */ response,
    /** @type {URL} */ requestUrl,
    /** @type {"callback" | "machine" | "onboarding" | "operator" | undefined} */ authority,
    /** @type {unknown} */ grant,
  ) {
    const path = requestUrl.pathname;
    const tokenMatch = /^\/api\/v1\/onboarding-tokens\/([^/]+)$/.exec(path);
    const guidanceMatch = /^\/api\/v1\/repositories\/([^/]+)\/guidance$/.exec(
      path,
    );
    const selectionMatch =
      /^\/api\/v1\/repositories\/([^/]+)\/review-selection$/.exec(path);
    const repositoryReviewMatch =
      /^\/api\/v1\/repositories\/([^/]+)\/reviews$/.exec(path);
    const reviewMetadataMatch =
      /^\/api\/v1\/onboarding\/reviews\/([^/]+)\/metadata$/.exec(path);
    const reviewVersionsMatch =
      /^\/api\/v1\/onboarding\/reviews\/([^/]+)\/versions$/.exec(path);
    const evaluationCreateMatch =
      /^\/api\/v1\/repositories\/([^/]+)\/evaluations$/.exec(path);
    const evaluationResultMatch =
      /^\/api\/v1\/evaluations\/([^/]+)\/result$/.exec(path);
    const evaluationMatch = /^\/api\/v1\/evaluations\/([^/]+)$/.exec(path);
    const recognized =
      path === "/api/v1/onboarding-tokens" ||
      path === "/api/v1/onboarding-token/revoke" ||
      path === "/api/v1/onboarding/repository" ||
      path === "/api/v1/repositories" ||
      path === "/api/v1/reviews" ||
      tokenMatch ||
      guidanceMatch ||
      selectionMatch ||
      repositoryReviewMatch ||
      reviewMetadataMatch ||
      reviewVersionsMatch ||
      evaluationCreateMatch ||
      evaluationResultMatch ||
      evaluationMatch;
    if (!recognized || !["operator", "onboarding"].includes(authority ?? "")) {
      return false;
    }
    if (
      authority === "operator" &&
      path !== "/api/v1/onboarding-tokens" &&
      !tokenMatch
    ) {
      return false;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
      if (authority === "operator") {
        if (request.method === "GET" && path === "/api/v1/onboarding-tokens") {
          writeJson(response, 200, {
            onboarding_tokens: onboardingTokens.list(),
          });
          return true;
        }
        if (request.method === "POST" && path === "/api/v1/onboarding-tokens") {
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          );
          writeJson(
            response,
            201,
            onboardingTokens.create(await readJsonRequest(request)),
          );
          return true;
        }
        if (request.method === "DELETE" && tokenMatch) {
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          );
          requireEmptyObject(await readJsonRequest(request));
          onboardingTokens.revoke(decode(tokenMatch[1]));
          writeStatus(response, 204);
          return true;
        }
        return false;
      }
      if (request.method === "GET" && path === "/api/v1/repositories") {
        writeJson(response, 200, operations.listRepositories(grant));
        return true;
      }
      if (request.method === "GET" && path === "/api/v1/reviews") {
        writeJson(response, 200, operations.listReviews());
        return true;
      }
      if (request.method === "GET" && guidanceMatch) {
        writeJson(
          response,
          200,
          operations.guidance(grant, decode(guidanceMatch[1])),
        );
        return true;
      }
      if (request.method === "GET" && evaluationResultMatch) {
        writeJson(
          response,
          200,
          operations.readEvaluationResult(
            grant,
            decode(evaluationResultMatch[1]),
          ),
        );
        return true;
      }
      if (request.method === "GET" && evaluationMatch) {
        writeJson(
          response,
          200,
          operations.readEvaluation(grant, decode(evaluationMatch[1])),
        );
        return true;
      }
      if (
        request.method === "POST" &&
        path === "/api/v1/onboarding/repository"
      ) {
        writeJson(
          response,
          201,
          await operations.registerRepository(
            grant,
            await readJsonRequest(request),
          ),
        );
        return true;
      }
      if (request.method === "PUT" && selectionMatch) {
        writeJson(
          response,
          200,
          operations.setReviews(
            grant,
            decode(selectionMatch[1]),
            await readJsonRequest(request),
          ),
        );
        return true;
      }
      if (request.method === "POST" && repositoryReviewMatch) {
        writeJson(
          response,
          201,
          operations.createReview(
            grant,
            decode(repositoryReviewMatch[1]),
            await readJsonRequest(request),
          ),
        );
        return true;
      }
      if (request.method === "POST" && evaluationCreateMatch) {
        const created = await operations.createEvaluation(
          grant,
          decode(evaluationCreateMatch[1]),
          await readJsonRequest(request),
          request.headers["idempotency-key"],
          "implementer_token",
        );
        writeJson(response, created.status, created.resource, {
          location: `/api/v1/evaluations/${encodeURIComponent(created.resource.id)}`,
        });
        return true;
      }
      if (request.method === "PATCH" && reviewMetadataMatch) {
        writeJson(
          response,
          200,
          operations.updateReviewMetadata(
            grant,
            decode(reviewMetadataMatch[1]),
            await readJsonRequest(request),
          ),
        );
        return true;
      }
      if (request.method === "POST" && reviewVersionsMatch) {
        writeJson(
          response,
          201,
          operations.saveReviewVersion(
            grant,
            decode(reviewVersionsMatch[1]),
            await readJsonRequest(request),
          ),
        );
        return true;
      }
      if (
        request.method === "POST" &&
        path === "/api/v1/onboarding-token/revoke"
      ) {
        requireEmptyObject(await readJsonRequest(request));
        operations.revoke(grant, bearerToken(request));
        writeStatus(response, 204);
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof Error && error.message === "request_malformed") {
        writeError(response, 400, "request_malformed", "Request is malformed");
        return true;
      }
      const failure = requireCodedError(error);
      const status = [
        "csrf_invalid",
        "origin_invalid",
        "authentication_required",
      ].includes(failure.code)
        ? browserMutationFailureStatus(failure.code)
        : /_not_found$/.test(failure.code)
          ? 404
          : /_conflict$|_already_active$/.test(failure.code)
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422;
      writeError(response, status, failure.code, failure.message);
      return true;
    }
  };
}
