import {
  currentIoOperationSignal,
  throwIfIoOperationAborted,
} from "./io-operation-context.js";
import { normalizedForgejoBaseUrl } from "./forgejo-v16-url.js";

/** @param {string} code @param {string} message @param {Record<string, unknown>} [facts] @returns {never} */
function fail(code, message, facts = {}) {
  throw Object.assign(new Error(message), { code, ...facts });
}

/** @param {unknown} value */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {Response} response @param {string} path */
async function responseArray(response, path) {
  if (!response.ok) {
    const responseStatus = response.status;
    const retryAfter = response.headers.get("retry-after");
    const rateReset = response.headers.get("x-ratelimit-reset");
    const now = Date.now();
    const retryAfterAt =
      retryAfter !== null && /^\d+$/.test(retryAfter)
        ? now + Number(retryAfter) * 1_000
        : retryAfter === null
          ? null
          : Date.parse(retryAfter);
    const rateResetAt =
      rateReset !== null && /^\d+$/.test(rateReset)
        ? Number(rateReset) * 1_000
        : null;
    const nextAttemptAt = [retryAfterAt, rateResetAt]
      .filter(
        (value) =>
          Number.isSafeInteger(value) && /** @type {number} */ (value) > now,
      )
      .sort(
        (left, right) =>
          /** @type {number} */ (left) - /** @type {number} */ (right),
      )[0];
    fail(
      responseStatus === 429
        ? "forgejo_api_rate_limited"
        : responseStatus >= 500
          ? "forgejo_api_transient_failure"
          : "forgejo_api_request_failed",
      `Forgejo reconciliation route failed with HTTP ${responseStatus}: ${path}`,
      {
        ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
        responseStatus,
      },
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

/** @param {typeof fetch} fetchRequest @param {{base_url: string, token: string}} connection @param {string} path */
async function get(fetchRequest, connection, path) {
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
    return await responseArray(response, path);
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

/** @param {typeof fetch} fetchRequest @param {any} connection @param {string} path */
async function pages(fetchRequest, connection, path) {
  const records = [];
  const identities = new Set();
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await get(
      fetchRequest,
      connection,
      `${path}${separator}limit=50&page=${page}`,
    );
    for (const candidate of batch) {
      const record = object(candidate);
      if (
        !record ||
        !Number.isSafeInteger(record.id) ||
        /** @type {number} */ (record.id) <= 0
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

/** @param {unknown} repository */
function encodedRepository(repository) {
  const candidate = object(repository);
  if (
    !candidate ||
    typeof candidate.full_name !== "string" ||
    candidate.full_name.split("/").length !== 2
  ) {
    fail(
      "forgejo_publication_request_invalid",
      "Forgejo reconciliation Repository is invalid",
    );
  }
  return candidate.full_name.split("/").map(encodeURIComponent).join("/");
}

/** @param {Record<string, unknown>[]} matches */
function reconciledIdentity(matches) {
  if (matches.length > 1) {
    fail(
      "forgejo_delivery_identity_conflict",
      "Forgejo reconciliation found duplicate source identities",
    );
  }
  return matches.length === 0 ? null : /** @type {number} */ (matches[0].id);
}

/** @param {{fetch?: typeof fetch}} [options] */
export function createForgejoV16Reconciler({
  fetch: fetchRequest = fetch,
} = {}) {
  return {
    /** @param {any} connection @param {any} repository @param {any} status */
    async reconcileCommitStatus(connection, repository, status) {
      const encoded = encodedRepository(repository);
      const matches = (
        await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${encoded}/statuses/${encodeURIComponent(status.head)}`,
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
      /** @type {any} */ connection,
      /** @type {any} */ repository,
      /** @type {number} */ pullRequestNumber,
      /** @type {string} */ body,
    ) {
      const encoded = encodedRepository(repository);
      const matches = (
        await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${encoded}/issues/${pullRequestNumber}/comments`,
        )
      ).filter((candidate) => candidate.body === body);
      return reconciledIdentity(matches);
    },
    async reconcileInlineFeedback(
      /** @type {any} */ connection,
      /** @type {any} */ repository,
      /** @type {number} */ pullRequestNumber,
      /** @type {any} */ comment,
    ) {
      const encoded = encodedRepository(repository);
      const reviews = await pages(
        fetchRequest,
        connection,
        `/api/v1/repos/${encoded}/pulls/${pullRequestNumber}/reviews`,
      );
      const matches = [];
      for (const review of reviews) {
        const comments = await pages(
          fetchRequest,
          connection,
          `/api/v1/repos/${encoded}/pulls/${pullRequestNumber}/reviews/${review.id}/comments`,
        );
        if (
          comments.some(
            (candidate) =>
              candidate.body === comment.body &&
              candidate.commit_id === comment.commit_id &&
              candidate.path === comment.path &&
              candidate.position ===
                (comment.side === "RIGHT" ? comment.line : 0) &&
              candidate.original_position ===
                (comment.side === "LEFT" ? comment.line : 0),
          )
        ) {
          matches.push(review);
        }
      }
      return reconciledIdentity(matches);
    },
  };
}
