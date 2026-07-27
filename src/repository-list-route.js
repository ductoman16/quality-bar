import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof import("./repository.js").createRepositoryService>} repositories
 * @param {{cursor?: string, limit?: string}} query
 */
export function writeRepositoryList(response, repositories, query) {
  try {
    writeJson(response, 200, repositories.listPage(query));
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
