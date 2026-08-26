import { writeAnalytics } from "./analytics/analytics-route.ts";
import { writeBrowserJsonMutation } from "./api-mutation.ts";
import { requireCodedError } from "./coded-error.ts";
import { isUnavailableError } from "./http-request.ts";
import { writeError, writeJson } from "./http-response.ts";
import { writeRepositoryDeletion } from "./repository/repository-delete-route.ts";
import { writeRepositoryGuidance } from "./repository/repository-guidance-route.ts";
import { writeRepositoryLifecycleChange } from "./repository/repository-lifecycle-route.ts";
import { writeRepositoryList } from "./repository/repository-list-route.ts";
import { writeReviewAssignmentMutation } from "./review/review-assignment-route.ts";
import { writeReviewDeletion } from "./review/review-delete-route.ts";
import { writeReviewList } from "./review/review-list-route.ts";

function pathParameter(
  request: import("fastify").FastifyRequest,
  name: string,
) {
  return (request.params as Record<string, string>)[name];
}

function query(request: import("fastify").FastifyRequest) {
  return Object.fromEntries(
    Object.entries(request.query as Record<string, unknown>).map(
      ([name, value]) => [
        name,
        typeof value === "number" ? String(value) : value,
      ],
    ),
  );
}

export type HttpHandler = (
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
) => unknown;

export function createApiOperations({
  listAuthorityAttributions,
  readSystemStatus,
  repositories,
  repositoryGuidance,
  reviews,
  analytics,
}: Omit<
  import("./api-route-contract.ts").ApiRouteDependencies,
  "forgejoConnections" | "githubConnections" | "recordAuthorityAttribution"
>) {
  const operations: Record<string, HttpHandler> = {
    getAnalytics(request, response) {
      writeAnalytics(response, analytics, query(request));
    },
    listReviews(request, response) {
      writeReviewList(
        response,
        reviews,
        query(request).state as string | undefined,
      );
    },
    listGenericRepositories(request, response) {
      writeRepositoryList(response, repositories, query(request));
    },
    getRepositoryGuidance(request, response) {
      writeRepositoryGuidance(
        response,
        repositoryGuidance,
        pathParameter(request, "repository_id"),
        request.headers["if-none-match"],
      );
    },
    async setReviewArchived(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "review_archival_failed",
        mutate: (body) =>
          reviews.setArchived(pathParameter(request, "review_id"), body),
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : isUnavailableError(error)
              ? 503
              : 422,
      });
    },
    async setReviewAssignment(request, response) {
      await writeReviewAssignmentMutation(request, response, {
        reviewId: pathParameter(request, "review_id"),
        reviews,
      });
    },
    async createReview(request, response) {
      try {
        writeJson(response, 201, reviews.create(request.body));
      } catch (error) {
        if (
          error instanceof Error &&
          (!("code" in error) || typeof error.code !== "string")
        ) {
          writeError(response, 500, "review_creation_failed", error.message);
          return;
        }
        const failure = requireCodedError(error);
        writeError(
          response,
          isUnavailableError(error) ? 503 : 422,
          failure.code,
          failure.message,
        );
      }
    },
    async registerGenericRepository(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "repository_registration_failed",
        mutate: (body) => repositories.register(body),
        statusFor: (code, error) =>
          code === "repository_identity_conflict"
            ? 409
            : isUnavailableError(error) ||
                code === "repository_git_verification_unavailable"
              ? 503
              : 422,
        unexpectedMessage: "Repository registration failed",
      });
    },
    async deleteNeverUsedReview(request, response) {
      await writeReviewDeletion(request, response, {
        reviews,
        reviewId: pathParameter(request, "review_id"),
      });
    },
    async deleteNeverUsedRepository(request, response) {
      await writeRepositoryDeletion(request, response, {
        repositories,
        repositoryId: pathParameter(request, "repository_id"),
      });
    },
    async rotateGenericRepositoryCredential(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "repository_credential_rotation_failed",
        mutate: (body) =>
          repositories.rotateCredential(
            pathParameter(request, "repository_id"),
            body,
          ),
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
    },
    async setRepositoryLifecycle(request, response) {
      await writeRepositoryLifecycleChange(request, response, {
        repositories,
        repositoryId: pathParameter(request, "repository_id"),
      });
    },
    async updateReviewMetadata(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "review_metadata_update_failed",
        mutate: (body) =>
          reviews.updateMetadata(pathParameter(request, "review_id"), body),
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_name_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
    },
    async saveReviewVersion(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "review_version_save_failed",
        mutate: (body) =>
          reviews.saveVersion(pathParameter(request, "review_id"), body),
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
    },
    async reactivateReviewVersion(request, response) {
      await writeBrowserJsonMutation(request, response, {
        failureCode: "review_version_reactivation_failed",
        mutate: (body) =>
          reviews.reactivateVersion(pathParameter(request, "review_id"), body),
        statusFor: (code, error) =>
          ["review_not_found", "review_version_not_found"].includes(code)
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
    },
    getSystem(request, response) {
      void request;
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        const failure = requireCodedError(error);
        const unavailable = isUnavailableError(error);
        writeError(
          response,
          unavailable ? 503 : 500,
          unavailable ? failure.code : "internal_error",
          unavailable ? failure.message : "Internal server error",
        );
      }
    },
    listAuthorityAttributions(request, response) {
      try {
        writeJson(response, 200, listAuthorityAttributions(query(request)));
      } catch (error) {
        const failure = requireCodedError(error);
        const invalid = ["cursor_invalid", "page_size_invalid"].includes(
          failure.code,
        );
        const unavailable = isUnavailableError(error);
        writeError(
          response,
          invalid ? 400 : unavailable ? 503 : 500,
          invalid || unavailable ? failure.code : "internal_error",
          invalid
            ? "Request is malformed"
            : unavailable
              ? failure.message
              : "Internal server error",
        );
      }
    },
  };
  return operations;
}
