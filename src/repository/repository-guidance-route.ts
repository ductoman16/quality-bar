import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson, writeStatus } from "../http-response.ts";

export function writeRepositoryGuidance(
  response: import("fastify").FastifyReply,
  repositoryGuidance: ReturnType<
    typeof import("./repository-guidance.ts").createRepositoryGuidanceService
  >,
  repositoryId: string,
  ifNoneMatch: string | string[] | undefined,
) {
  try {
    const guidance = repositoryGuidance.read(repositoryId);
    const entityTag = `"${guidance.guidance_revision}"`;
    if (ifNoneMatch === entityTag) {
      writeStatus(response, 304, { etag: entityTag });
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
