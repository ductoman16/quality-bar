import { reviewAssignmentPathIdentity } from "./review-assignment-route.js";

/** @param {string} path */
export function apiResourceMatches(path) {
  return {
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
