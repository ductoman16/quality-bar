import { forbidMachineOperatorAccess } from "./api-authorization.js";
import { writeBrowserJsonMutation } from "./api-mutation.js";
import { assertApiQueryParameters } from "./api-query.js";
import {
  apiResourceMatches,
  isOperatorOnlyApiRoute,
} from "./api-resource-matches.js";
import { canonicalOpenApiDocument } from "./canonical-api.js";
import {
  browserMutationFailureStatus,
  isUnavailableError,
  readAuthorityAttributionQuery,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { createGitHubConnectionRoute } from "./github-connection-route.js";
import { createForgejoConnectionRoute } from "./forgejo-connection-route.js";
import { writeRepositoryGuidance } from "./repository-guidance-route.js";
import { writeRepositoryLifecycleChange } from "./repository-lifecycle-route.js";
import { writeRepositoryList } from "./repository-list-route.js";
import { writeRepositoryDeletion } from "./repository-delete-route.js";
import { writeReviewAssignmentMutation } from "./review-assignment-route.js";
import { writeReviewList } from "./review-list-route.js";
import { writeReviewDeletion } from "./review-delete-route.js";
import { writeError, writeJson } from "./http-response.js";
import { writeAnalytics } from "./analytics-route.js";

/** @param {import("./api-route-contract.js").ApiRouteDependencies} dependencies */
export function createApiRoute({
  browserOrigin,
  browserSessions,
  listAuthorityAttributions,
  readSystemStatus,
  recordAuthorityAttribution,
  repositories,
  githubConnections,
  forgejoConnections,
  repositoryGuidance,
  reviews,
  analytics,
}) {
  const handleGitHubConnection = createGitHubConnectionRoute({
    browserOrigin,
    browserSessions,
    githubConnections,
  });
  const handleForgejoConnection = createForgejoConnectionRoute({
    browserOrigin,
    browserSessions,
    forgejoConnections,
  });
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   * @param {"callback" | "machine" | "operator" | undefined} authority
   */
  return async function handleApi(request, response, requestUrl, authority) {
    const { method } = request;
    const path = requestUrl.pathname;
    if (path !== "/api/v1" && !path.startsWith("/api/v1/")) {
      return false;
    }
    const matches = apiResourceMatches(path);
    const {
      repositoryMatch,
      repositoryCredentialRotationMatch,
      repositoryGuidanceMatch,
      repositoryLifecycleMatch,
      reviewMatch,
      reviewActiveVersionMatch,
      reviewArchivalMatch,
      reviewAssignmentId,
      reviewMetadataMatch,
      reviewVersionsMatch,
    } = matches;
    if (
      authority === "machine" &&
      isOperatorOnlyApiRoute(method, path, matches)
    ) {
      forbidMachineOperatorAccess(response, recordAuthorityAttribution);
      return true;
    }
    if (
      authority === "machine" &&
      ["/api/v1/system", "/api/v1/system/authority-attributions"].includes(path)
    ) {
      forbidMachineOperatorAccess(response, recordAuthorityAttribution);
      return true;
    }
    if (
      (await handleGitHubConnection(
        request,
        response,
        requestUrl,
        authority,
      )) ||
      (await handleForgejoConnection(request, response, requestUrl, authority))
    ) {
      return true;
    }
    try {
      assertApiQueryParameters(method, path, requestUrl);
    } catch (error) {
      const failure = requireCodedError(error);
      writeError(response, 400, failure.code, failure.message);
      return true;
    }
    if (method === "GET" && path === "/api/v1/openapi.json") {
      writeJson(response, 200, canonicalOpenApiDocument());
      return true;
    }
    if (method === "GET" && path === "/api/v1/analytics") {
      writeAnalytics(response, analytics, requestUrl.searchParams);
      return true;
    }
    if (method === "GET" && path === "/api/v1/reviews") {
      writeReviewList(
        response,
        reviews,
        requestUrl.searchParams.get("state") ?? undefined,
      );
      return true;
    }
    if (method === "GET" && path === "/api/v1/repositories") {
      writeRepositoryList(response, repositories, {
        cursor: requestUrl.searchParams.get("cursor") ?? undefined,
        limit: requestUrl.searchParams.get("limit") ?? undefined,
      });
      return true;
    }
    if (method === "GET" && repositoryGuidanceMatch) {
      writeRepositoryGuidance(
        response,
        repositoryGuidance,
        repositoryGuidanceMatch[1],
        request.headers["if-none-match"],
      );
      return true;
    }
    if (method === "PATCH" && reviewArchivalMatch) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_archival_failed",
        mutate: (body) =>
          reviews.setArchived(decodeURIComponent(reviewArchivalMatch[1]), body),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : isUnavailableError(error)
              ? 503
              : 422,
      });
      return true;
    }
    if (method === "PATCH" && reviewAssignmentId) {
      await writeReviewAssignmentMutation(request, response, {
        browserOrigin,
        browserSessions,
        requestUrl,
        reviewId: reviewAssignmentId,
        reviews,
      });
      return true;
    }
    if (method === "POST" && path === "/api/v1/reviews") {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        writeJson(
          response,
          201,
          reviews.create(await readJsonRequest(request)),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (!("code" in error) || typeof error.code !== "string")
        ) {
          writeError(response, 500, "review_creation_failed", error.message);
          return true;
        }
        const failure = requireCodedError(error);
        if (failure.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else if (
          [
            "csrf_invalid",
            "origin_invalid",
            "authentication_required",
          ].includes(failure.code)
        ) {
          writeError(
            response,
            browserMutationFailureStatus(failure.code),
            failure.code,
            failure.message,
          );
        } else {
          const unavailable = isUnavailableError(error);
          writeError(
            response,
            unavailable ? 503 : 422,
            failure.code,
            failure.message,
          );
        }
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/repositories") {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "repository_registration_failed",
        mutate: (body) => repositories.register(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "repository_identity_conflict"
            ? 409
            : isUnavailableError(error) ||
                code === "repository_git_verification_unavailable"
              ? 503
              : 422,
        unexpectedMessage: "Repository registration failed",
      });
      return true;
    }
    if (method === "DELETE" && reviewMatch) {
      await writeReviewDeletion(request, response, {
        browserOrigin,
        browserSessions,
        reviews,
        encodedReviewId: reviewMatch[1],
        requestUrl,
      });
      return true;
    }
    if (method === "DELETE" && repositoryMatch) {
      await writeRepositoryDeletion(request, response, {
        browserOrigin,
        browserSessions,
        repositories,
        encodedRepositoryId: repositoryMatch[1],
        requestUrl,
      });
      return true;
    }
    if (method === "POST" && repositoryCredentialRotationMatch) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "repository_credential_rotation_failed",
        mutate: (body) =>
          repositories.rotateCredential(
            decodeURIComponent(repositoryCredentialRotationMatch[1]),
            body,
          ),
        requestUrl,
        statusFor: (code, error) =>
          code === "repository_not_found"
            ? 404
            : [
                  "repository_credential_not_found",
                  "repository_credential_rotation_conflict",
                ].includes(code)
              ? 409
              : isUnavailableError(error) ||
                  code === "repository_git_verification_unavailable"
                ? 503
                : 422,
        unexpectedMessage: "Repository credential rotation failed",
      });
      return true;
    }
    if (method === "PATCH" && repositoryLifecycleMatch) {
      await writeRepositoryLifecycleChange(request, response, {
        browserOrigin,
        browserSessions,
        repositories,
        encodedRepositoryId: repositoryLifecycleMatch[1],
        requestUrl,
      });
      return true;
    }
    if (method === "PATCH" && reviewMetadataMatch) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_metadata_update_failed",
        mutate: (body) =>
          reviews.updateMetadata(
            decodeURIComponent(reviewMetadataMatch[1]),
            body,
          ),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_name_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "POST" && reviewVersionsMatch) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_version_save_failed",
        mutate: (body) =>
          reviews.saveVersion(decodeURIComponent(reviewVersionsMatch[1]), body),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "PATCH" && reviewActiveVersionMatch) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_version_reactivation_failed",
        mutate: (body) =>
          reviews.reactivateVersion(
            decodeURIComponent(reviewActiveVersionMatch[1]),
            body,
          ),
        requestUrl,
        statusFor: (code, error) =>
          ["review_not_found", "review_version_not_found"].includes(code)
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "GET" && path === "/api/v1/system") {
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(
          response,
          isUnavailableError(error) ? 503 : 500,
          isUnavailableError(error) ? failure.code : "internal_error",
          isUnavailableError(error) ? failure.message : "Internal server error",
        );
      }
      return true;
    }
    if (method === "GET" && path === "/api/v1/system/authority-attributions") {
      try {
        writeJson(
          response,
          200,
          listAuthorityAttributions(readAuthorityAttributionQuery(requestUrl)),
        );
      } catch (error) {
        const failure = requireCodedError(error);
        const status = [
          "cursor_invalid",
          "page_size_invalid",
          "request_malformed",
        ].includes(failure.code)
          ? 400
          : isUnavailableError(error)
            ? 503
            : 500;
        writeError(
          response,
          status,
          status === 400 || status === 503 ? failure.code : "internal_error",
          status === 400
            ? "Request is malformed"
            : status === 503
              ? failure.message
              : "Internal server error",
        );
      }
      return true;
    }
    return false;
  };
}
