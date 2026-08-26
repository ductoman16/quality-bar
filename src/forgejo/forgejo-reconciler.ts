import {
  currentIoOperationSignal,
  throwIfIoOperationAborted,
} from "../io-operation-context.ts";
import { normalizedForgejoBaseUrl } from "./forgejo-url.ts";
import { forgejoResponseFailure } from "./forgejo-response-failure.ts";

function fail(
  code: string,
  message: string,
  facts: Record<string, unknown> = {},
): never {
  throw Object.assign(new Error(message), { code, ...facts });
}

function object(value: unknown) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function responseArray(
  response: Response,
  path: string,
  repositoryId: number,
) {
  if (!response.ok) {
    throw forgejoResponseFailure(
      response,
      path,
      "reconciliation",
      repositoryId,
    );
  }
  try {
    const body = await response.json();
    if (!Array.isArray(body)) {
      fail(
        "forgejo_api_response_invalid",
        `Forgejo reconciliation response is invalid: ${path}`,
      );
    }
    return body;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) {
      throw cause;
    }
    fail(
      "forgejo_api_response_invalid",
      `Forgejo reconciliation response is invalid: ${path}`,
    );
  }
}

async function get(
  fetchRequest: typeof fetch,
  connection: { base_url: string; token: string },
  path: string,
  repositoryId: number,
) {
  if (typeof connection?.token !== "string" || connection.token.length === 0) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo reconciliation requires a PAT",
    );
  }
  const origin = normalizedForgejoBaseUrl(connection.base_url);
  const signal = currentIoOperationSignal();
  signal?.throwIfAborted();
  try {
    const response = await fetchRequest(`${origin}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `token ${connection.token}`,
      },
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    return await responseArray(response, path, repositoryId);
  } catch (cause) {
    throwIfIoOperationAborted(cause);
    if (cause instanceof Error && "code" in cause) {
      throw cause;
    }
    fail(
      "forgejo_api_unavailable",
      `Forgejo reconciliation route is unavailable: ${path}`,
    );
  }
}

async function pages(
  fetchRequest: typeof fetch,
  connection: any,
  path: string,
  repositoryId: number,
) {
  const records = [];
  const identities = new Set();
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await get(
      fetchRequest,
      connection,
      `${path}${separator}limit=50&page=${page}`,
      repositoryId,
    );
    for (const candidate of batch) {
      const record = object(candidate);
      if (
        !record ||
        !Number.isSafeInteger(record.id) ||
        (record.id as number) <= 0
      ) {
        fail(
          "forgejo_api_response_invalid",
          `Forgejo reconciliation response is invalid: ${path}`,
        );
      }
      if (identities.has(record.id)) {
        fail(
          "forgejo_api_response_invalid",
          `Forgejo reconciliation response repeats identity: ${path}`,
        );
      }
      identities.add(record.id);
      records.push(record);
    }
    if (batch.length < 50) {
      return records;
    }
  }
}

function selectedRepository(repository: unknown) {
  const candidate = object(repository);
  if (
    !candidate ||
    typeof candidate.full_name !== "string" ||
    candidate.full_name.split("/").length !== 2 ||
    !Number.isSafeInteger(candidate.id) ||
    (candidate.id as number) <= 0
  ) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo reconciliation Repository is invalid",
    );
  }
  return {
    encoded: candidate.full_name.split("/").map(encodeURIComponent).join("/"),
    id: candidate.id as number,
  };
}

function reconciledIdentity(matches: Record<string, unknown>[]) {
  if (matches.length > 1) {
    fail(
      "forgejo_delivery_identity_conflict",
      "Forgejo reconciliation found duplicate source identities",
    );
  }
  return matches.length === 0 ? null : (matches[0].id as number);
}

export function createForgejoReconciler({
  fetch: fetchRequest = fetch,
}: { fetch?: typeof fetch } = {}) {
  return {
    async reconcileCommitStatus(connection: any, repository: any, status: any) {
      const selected = selectedRepository(repository);
      const matches = (
        await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${selected.encoded}/statuses/${encodeURIComponent(status.head)}`,
          selected.id,
        )
      ).filter(
        (candidate) =>
          candidate.context === "Quality Bar" &&
          candidate.description === status.description &&
          (candidate.state ?? candidate.status) === status.state &&
          candidate.target_url === status.targetUrl,
      );
      return reconciledIdentity(matches);
    },
    async reconcileAggregateFeedback(
      connection: any,
      repository: any,
      pullRequestNumber: number,
      body: string,
    ) {
      const selected = selectedRepository(repository);
      const matches = (
        await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${selected.encoded}/issues/${pullRequestNumber}/comments`,
          selected.id,
        )
      ).filter((candidate) => candidate.body === body);
      return reconciledIdentity(matches);
    },
    async reconcileInlineFeedback(
      connection: any,
      repository: any,
      pullRequestNumber: number,
      comment: any,
    ) {
      const selected = selectedRepository(repository);
      const reviews = await pages(
        fetchRequest,
        connection,
        `/api/v1/repos/${selected.encoded}/pulls/${pullRequestNumber}/reviews`,
        selected.id,
      );
      const matches = [];
      for (const review of reviews) {
        const comments = await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${selected.encoded}/pulls/${pullRequestNumber}/reviews/${review.id}/comments`,
          selected.id,
        );
        for (const candidate of comments) {
          if (
            candidate.body === comment.body &&
            candidate.commit_id === comment.commit_id &&
            candidate.path === comment.path &&
            candidate.position ===
              (comment.side === "RIGHT" ? comment.line : 0) &&
            candidate.original_position ===
              (comment.side === "LEFT" ? comment.line : 0) &&
            candidate.extra_lines_count ===
              (comment.start_line === undefined
                ? 0
                : comment.line - comment.start_line)
          ) {
            matches.push(review);
          }
        }
      }
      return reconciledIdentity(matches);
    },
  };
}
