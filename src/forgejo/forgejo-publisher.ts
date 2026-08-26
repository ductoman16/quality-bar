import {
  currentIoOperationSignal,
  throwIfIoOperationAborted,
} from "../io-operation-context.ts";
import { normalizedForgejoBaseUrl } from "./forgejo-url.ts";
import { createForgejoReconciler } from "./forgejo-reconciler.ts";
import { forgejoResponseFailure } from "./forgejo-response-failure.ts";

function fail(code: string, message: string, cause?: unknown): never {
  throw Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function publicationConnection(baseUrl: string, token: string) {
  if (typeof token !== "string" || token.length === 0) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo publication requires a PAT",
    );
  }
  return { origin: normalizedForgejoBaseUrl(baseUrl), token };
}

function publicationRepository(value: unknown) {
  const candidate = object(value);
  if (
    !candidate ||
    typeof candidate.full_name !== "string" ||
    candidate.full_name.length === 0 ||
    candidate.full_name.split("/").length !== 2 ||
    candidate.full_name.split("/").some((part) => part.length === 0) ||
    !Number.isSafeInteger(candidate.id) ||
    (candidate.id as number) <= 0
  ) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo publication Repository is invalid",
    );
  }
  return {
    fullName: candidate.full_name as string,
    id: candidate.id as number,
  };
}

async function forgejoPublicationRequest(
  fetchRequest: typeof fetch,
  connection: { base_url: string; token: string },
  path: string,
  body: Record<string, unknown>,
  expectedStatus: number,
  repositoryId: number,
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
    throw forgejoResponseFailure(response, path, "publication", repositoryId);
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

function publicationNumber(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail("forgejo_api_response_invalid", message);
  }
  return value as number;
}

export function createForgejoPublisher({
  fetch: fetchRequest = fetch,
}: { fetch?: typeof fetch } = {}) {
  if (typeof fetchRequest !== "function") {
    throw new TypeError("Forgejo publisher dependencies are invalid");
  }

  return {
    ...createForgejoReconciler({ fetch: fetchRequest }),
    async publishCommitStatus(
      connection: { base_url: string; token: string },
      repository: { full_name: string; id: number },
      status: {
        description: string;
        head: string;
        state: string;
        targetUrl: string;
      },
    ) {
      const selectedRepository = publicationRepository(repository);
      const selectedStatus = object(status);
      if (
        !selectedStatus ||
        typeof selectedStatus.description !== "string" ||
        selectedStatus.description.length === 0 ||
        typeof selectedStatus.head !== "string" ||
        !["pending", "success", "failure", "error"].includes(
          selectedStatus.state as string,
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
      const head = selectedStatus.head as string;
      const state = selectedStatus.state as string;
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
      return responseId as number;
    },
    async publishAggregateFeedback(
      connection: { base_url: string; token: string },
      repository: { full_name: string; id: number },
      pullRequestNumber: number,
      body: string,
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
    async publishInlineFeedback(
      connection: { base_url: string; token: string },
      repository: { full_name: string; id: number },
      pullRequestNumber: number,
      comment: {
        body: string;
        commit_id: string;
        line: number;
        path: string;
        side: "LEFT" | "RIGHT";
        start_line?: number;
        start_side?: "LEFT" | "RIGHT";
      },
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
