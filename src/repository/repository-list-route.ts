import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson } from "../http-response.ts";

export function writeRepositoryList(
  response: import("fastify").FastifyReply,
  repositories: Pick<
    ReturnType<typeof import("./repository.ts").createRepositoryService>,
    "listPage"
  >,
  query: { cursor?: string; limit?: string },
) {
  try {
    const page = repositories.listPage(query);
    writeJson(response, 200, page);
  } catch (error) {
    const failure = requireCodedError(error);
    if (["cursor_invalid", "page_size_invalid"].includes(failure.code)) {
      writeError(response, 400, failure.code, failure.message);
    } else if (isUnavailableError(error)) {
      writeError(response, 503, failure.code, failure.message);
    } else {
      writeError(
        response,
        500,
        "repository_list_failed",
        "Repository listing failed",
      );
    }
  }
}
