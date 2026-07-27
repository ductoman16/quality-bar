import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>} repositoryGuidance
 * @param {string} repositoryId
 * @param {string | string[] | undefined} ifNoneMatch
 */
export function writeRepositoryGuidance(
  response,
  repositoryGuidance,
  repositoryId,
  ifNoneMatch,
) {
  try {
    const guidance = repositoryGuidance.read(repositoryId);
    const entityTag = `"${guidance.guidance_revision}"`;
    if (ifNoneMatch === entityTag) {
      response.writeHead(304, { etag: entityTag });
      response.end();
    } else {
      writeJson(response, 200, guidance, { etag: entityTag });
    }
  } catch (error) {
    const failure = requireCodedError(error);
    if (failure.code === "repository_not_found") {
      writeError(response, 404, failure.code, failure.message);
    } else if (isUnavailableError(error)) {
      writeError(response, 503, failure.code, failure.message);
    } else {
      writeError(
        response,
        500,
        "repository_guidance_failed",
        "Repository Guidance failed",
      );
    }
  }
}
