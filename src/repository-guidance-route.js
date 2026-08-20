import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson, writeStatus } from "./http-response.js";

/**
 * @param {import("fastify").FastifyReply} response
 * @param {ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>} repositoryGuidance
 * @param {string} encodedRepositoryId
 * @param {string | string[] | undefined} ifNoneMatch
 */
export function writeRepositoryGuidance(
  response,
  repositoryGuidance,
  encodedRepositoryId,
  ifNoneMatch,
) {
  try {
    const repositoryId = decodeURIComponent(encodedRepositoryId);
    const guidance = repositoryGuidance.read(repositoryId);
    const entityTag = `"${guidance.guidance_revision}"`;
    if (ifNoneMatch === entityTag) {
      writeStatus(response, 304, { etag: entityTag });
    } else {
      writeJson(response, 200, guidance, { etag: entityTag });
    }
  } catch (error) {
    if (error instanceof URIError) {
      writeError(response, 400, "request_malformed", "Request is malformed");
      return;
    }
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
