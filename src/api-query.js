import { assertAllowedQueryParameters } from "./http-request.js";

/**
 * @param {string | undefined} method
 * @param {string} path
 * @param {URL} requestUrl
 */
export function assertApiQueryParameters(method, path, requestUrl) {
  if (path === "/api/v1/system/authority-attributions") {
    assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
    return;
  }
  if (method === "GET" && path === "/api/v1/repositories") {
    assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
    return;
  }
  if (method === "GET" && path === "/api/v1/reviews") {
    assertAllowedQueryParameters(requestUrl, new Set(["state"]));
    return;
  }
  if (method === "GET" && path === "/api/v1/analytics") {
    assertAllowedQueryParameters(
      requestUrl,
      new Set([
        "base_commit",
        "criterion_id",
        "end",
        "head_commit",
        "model",
        "pull_request_number",
        "reasoning_effort",
        "repository_id",
        "review_id",
        "review_version_id",
        "service_tier",
        "start",
        "terminal_outcome",
      ]),
    );
    return;
  }
  assertAllowedQueryParameters(requestUrl, new Set());
}
