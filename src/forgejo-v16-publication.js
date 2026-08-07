import {
  currentIoOperationSignal,
  throwIfIoOperationAborted,
} from "./io-operation-context.js";
import { normalizedForgejoBaseUrl } from "./forgejo-v16-url.js";
import { createForgejoV16Reconciler } from "./forgejo-v16-reconciliation.js";
import { forgejoV16ResponseFailure } from "./forgejo-v16-response-failure.js";

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
function fail(code, message, cause) {
  throw Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {string} baseUrl @param {string} token */
function publicationConnection(baseUrl, token) {
  if (typeof token !== "string" || token.length === 0) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo publication requires a PAT",
    );
  }
  return { origin: normalizedForgejoBaseUrl(baseUrl), token };
}

/** @param {unknown} value */
function publicationRepository(value) {
  const candidate = object(value);
  if (
    !candidate ||
    typeof candidate.full_name !== "string" ||
    candidate.full_name.length === 0 ||
    candidate.full_name.split("/").length !== 2 ||
    candidate.full_name.split("/").some((part) => part.length === 0) ||
    !Number.isSafeInteger(candidate.id) ||
    /** @type {number} */ (candidate.id) <= 0
  ) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo publication Repository is invalid",
    );
  }
  return {
    fullName: /** @type {string} */ (candidate.full_name),
    id: /** @type {number} */ (candidate.id),
  };
}

/**
 * @param {typeof fetch} fetchRequest
 * @param {{base_url: string, token: string}} connection
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {number} expectedStatus
 * @param {number} repositoryId
 */
async function forgejoPublicationRequest(
  fetchRequest,
  connection,
  path,
  body,
  expectedStatus,
  repositoryId,
) {
  const { origin, token } = publicationConnection(
    connection?.base_url,
    connection?.token,
  );
  const signal = currentIoOperationSignal();
  signal?.throwIfAborted();
  let response;
  try {
    response = await fetchRequest(`${origin}${path}`, {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        authorization: `token ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throwIfIoOperationAborted(cause);
    fail(
      "forgejo_api_unavailable",
      `Forgejo publication route is unavailable: ${path}`,
      cause,
    );
  }
  signal?.throwIfAborted();
  if (response.status !== expectedStatus) {
    throw forgejoV16ResponseFailure(
      response,
      path,
      "publication",
      repositoryId,
    );
  }
  try {
    return await response.json();
  } catch (cause) {
    fail(
      "forgejo_api_response_invalid",
      `Forgejo publication response is invalid: ${path}`,
      cause,
    );
  }
}

/** @param {unknown} value @param {string} message */
function publicationNumber(value, message) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    fail("forgejo_api_response_invalid", message);
  }
  return /** @type {number} */ (value);
}

/** @param {{fetch?: typeof fetch}} [options] */
export function createForgejoV16Publisher({
  fetch: fetchRequest = fetch,
} = {}) {
  if (typeof fetchRequest !== "function") {
    throw new TypeError("Forgejo publisher dependencies are invalid");
  }

  return {
    ...createForgejoV16Reconciler({ fetch: fetchRequest }),
    /**
     * @param {{base_url: string, token: string}} connection
     * @param {{full_name: string, id: number}} repository
     * @param {{description: string, head: string, state: string, targetUrl: string}} status
     */
    async publishCommitStatus(connection, repository, status) {
      const selectedRepository = publicationRepository(repository);
      const selectedStatus = object(status);
      if (
        !selectedStatus ||
        typeof selectedStatus.description !== "string" ||
        selectedStatus.description.length === 0 ||
        typeof selectedStatus.head !== "string" ||
        !["pending", "success", "failure", "error"].includes(
          /** @type {string} */ (selectedStatus.state),
        ) ||
        typeof selectedStatus.targetUrl !== "string"
      ) {
        fail(
          "forgejo_publication_request_invalid",
          "Forgejo commit status request is invalid",
        );
      }
      const encoded = selectedRepository.fullName
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const head = /** @type {string} */ (selectedStatus.head);
      const state = /** @type {string} */ (selectedStatus.state);
      const body = await forgejoPublicationRequest(
        fetchRequest,
        connection,
        `/api/v1/repos/${encoded}/statuses/${encodeURIComponent(head)}`,
        {
          context: "Quality Bar",
          description: selectedStatus.description,
          state,
          target_url: selectedStatus.targetUrl,
        },
        201,
        selectedRepository.id,
      );
      const response = object(body);
      const responseId = response
        ? publicationNumber(
            response.id,
            "Forgejo commit status response is invalid",
          )
        : null;
      if (
        !response ||
        (response.sha !== undefined && response.sha !== head) ||
        (response.state !== undefined && response.state !== state) ||
        (response.status !== undefined && response.status !== state) ||
        (response.state === undefined && response.status === undefined) ||
        response.context !== "Quality Bar" ||
        response.target_url !== selectedStatus.targetUrl
      ) {
        fail(
          "forgejo_api_response_invalid",
          "Forgejo commit status response is invalid",
        );
      }
      return /** @type {number} */ (responseId);
    },
    /**
     * @param {{base_url: string, token: string}} connection
     * @param {{full_name: string, id: number}} repository
     * @param {number} pullRequestNumber
     * @param {string} body
     */
    async publishAggregateFeedback(
      connection,
      repository,
      pullRequestNumber,
      body,
    ) {
      const selectedRepository = publicationRepository(repository);
      if (
        !Number.isSafeInteger(pullRequestNumber) ||
        pullRequestNumber <= 0 ||
        typeof body !== "string" ||
        body.length === 0
      ) {
        fail(
          "forgejo_publication_request_invalid",
          "Forgejo aggregate feedback request is invalid",
        );
      }
      const encoded = selectedRepository.fullName
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const response = object(
        await forgejoPublicationRequest(
          fetchRequest,
          connection,
          `/api/v1/repos/${encoded}/issues/${pullRequestNumber}/comments`,
          { body },
          201,
          selectedRepository.id,
        ),
      );
      if (
        !response ||
        typeof response.body !== "string" ||
        response.body !== body
      ) {
        fail(
          "forgejo_api_response_invalid",
          "Forgejo aggregate feedback response is invalid",
        );
      }
      return publicationNumber(
        response.id,
        "Forgejo aggregate feedback response is invalid",
      );
    },
    /**
     * @param {{base_url: string, token: string}} connection
     * @param {{full_name: string, id: number}} repository
     * @param {number} pullRequestNumber
     * @param {{body: string, commit_id: string, line: number, path: string, side: "LEFT" | "RIGHT", start_line?: number, start_side?: "LEFT" | "RIGHT"}} comment
     */
    async publishInlineFeedback(
      connection,
      repository,
      pullRequestNumber,
      comment,
    ) {
      const selectedRepository = publicationRepository(repository);
      if (
        !Number.isSafeInteger(pullRequestNumber) ||
        pullRequestNumber <= 0 ||
        typeof comment?.body !== "string" ||
        comment.body.length === 0 ||
        typeof comment.commit_id !== "string" ||
        typeof comment.path !== "string" ||
        comment.path.length === 0 ||
        !["LEFT", "RIGHT"].includes(comment.side) ||
        !Number.isSafeInteger(comment.line) ||
        comment.line <= 0 ||
        (comment.start_line !== undefined &&
          (!Number.isSafeInteger(comment.start_line) ||
            comment.start_line <= 0 ||
            comment.start_line > comment.line)) ||
        (comment.start_line === undefined) !==
          (comment.start_side === undefined) ||
        (comment.start_line !== undefined &&
          comment.start_side !== comment.side)
      ) {
        fail(
          "forgejo_publication_request_invalid",
          "Forgejo inline feedback request is invalid",
        );
      }
      const encoded = selectedRepository.fullName
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const oldPosition = comment.side === "LEFT" ? comment.line : 0;
      const newPosition = comment.side === "RIGHT" ? comment.line : 0;
      const review = object(
        await forgejoPublicationRequest(
          fetchRequest,
          connection,
          `/api/v1/repos/${encoded}/pulls/${pullRequestNumber}/reviews`,
          {
            body: "",
            commit_id: comment.commit_id,
            comments: [
              {
                body: comment.body,
                extra_lines_count:
                  comment.start_line === undefined
                    ? 0
                    : comment.line - comment.start_line,
                new_position: newPosition,
                old_position: oldPosition,
                path: comment.path,
              },
            ],
            event: "COMMENT",
          },
          200,
          selectedRepository.id,
        ),
      );
      if (
        !review ||
        review.commit_id !== comment.commit_id ||
        review.comments_count !== 1
      ) {
        fail(
          "forgejo_api_response_invalid",
          "Forgejo inline feedback response is invalid",
        );
      }
      return publicationNumber(
        review.id,
        "Forgejo inline feedback response is invalid",
      );
    },
  };
}
