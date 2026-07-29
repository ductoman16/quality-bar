import { reviewAssignmentPathIdentity } from "./review-assignment-route.js";

/** @param {string} path */
export function apiResourceMatches(path) {
  return {
    reviewMatch: path.match(/^\/api\/v1\/reviews\/([^/]+)$/),
    repositoryMatch: path.match(/^\/api\/v1\/repositories\/([^/]+)$/),
    repositoryCredentialRotationMatch: path.match(
      /^\/api\/v1\/repositories\/([^/]+)\/credential\/rotate$/,
    ),
    repositoryGuidanceMatch: path.match(
      /^\/api\/v1\/repositories\/([^/]+)\/guidance$/,
    ),
    repositoryLifecycleMatch: path.match(
      /^\/api\/v1\/repositories\/([^/]+)\/lifecycle$/,
    ),
    reviewActiveVersionMatch: path.match(
      /^\/api\/v1\/reviews\/([^/]+)\/active-version$/,
    ),
    reviewArchivalMatch: path.match(/^\/api\/v1\/reviews\/([^/]+)\/archival$/),
    reviewAssignmentId: reviewAssignmentPathIdentity(path),
    reviewMetadataMatch: path.match(/^\/api\/v1\/reviews\/([^/]+)\/metadata$/),
    reviewVersionsMatch: path.match(/^\/api\/v1\/reviews\/([^/]+)\/versions$/),
  };
}

/**
 * @param {string | undefined} method
 * @param {string} path
 * @param {ReturnType<typeof apiResourceMatches>} matches
 */
export function isOperatorOnlyApiRoute(method, path, matches) {
  return (
    (method === "GET" && path === "/api/v1/reviews") ||
    (method === "POST" && path === "/api/v1/reviews") ||
    (method === "DELETE" && matches.reviewMatch) ||
    (method === "PATCH" && matches.reviewMetadataMatch) ||
    (method === "PATCH" && matches.reviewArchivalMatch) ||
    (method === "PATCH" && matches.reviewAssignmentId) ||
    (method === "PATCH" && matches.reviewActiveVersionMatch) ||
    (method === "POST" && matches.reviewVersionsMatch) ||
    (method === "POST" && path === "/api/v1/repositories") ||
    (method === "DELETE" && matches.repositoryMatch) ||
    (method === "POST" && matches.repositoryCredentialRotationMatch) ||
    (method === "PATCH" && matches.repositoryLifecycleMatch) ||
    path.startsWith("/api/v1/github-connections") ||
    path.startsWith("/api/v1/forgejo-connections")
  );
}
