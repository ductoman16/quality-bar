import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * @param {{provider: "github" | "forgejo", now: number, externalStatePath: string, operations: string[]}}
 *   input
 */
export function createProviderHarness({
  provider,
  now,
  externalStatePath,
  operations,
}) {
  const externalState = existsSync(externalStatePath)
    ? JSON.parse(readFileSync(externalStatePath, "utf8"))
    : { aggregateBody: null, inlineComments: [] };
  if (
    !externalState ||
    (externalState.aggregateBody !== null &&
      typeof externalState.aggregateBody !== "string") ||
    !Array.isArray(externalState.inlineComments)
  ) {
    throw new TypeError("provider recovery external state is invalid");
  }

  function persistExternalState() {
    writeFileSync(externalStatePath, JSON.stringify(externalState));
  }

  let aggregateCreates = 0;
  let inlineCreates = 0;
  let commitCreates = 0;
  let aggregateBody = externalState.aggregateBody;
  /** @type {any[]} */
  const inlineComments = externalState.inlineComments;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const githubCredential = {
    app_id: 47,
    app_slug: "quality-bar",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const permissions = {
    contents: "read",
    issues: "write",
    metadata: "read",
    pull_requests: "write",
    statuses: "write",
  };

  /** @param {RequestInit} options */
  function requestBody(options) {
    return typeof options.body === "string" ? JSON.parse(options.body) : null;
  }

  /** @param {string} path @param {boolean} [includeRetryAfter] */
  function rateLimitedResponse(path, includeRetryAfter = true) {
    return Response.json(
      { message: `rate limit active: ${path}` },
      {
        ...(includeRetryAfter ? { headers: { "retry-after": "60" } } : {}),
        status: 429,
      },
    );
  }

  /** @type {typeof fetch} */
  const githubFetch = async (requestUrl, options = {}) => {
    const url = new URL(requestUrl);
    const method = options.method ?? "GET";
    if (
      method === "POST" &&
      url.pathname === "/app/installations/73/access_tokens"
    ) {
      return Response.json({ permissions, token: "installation-token" });
    }
    if (
      method === "GET" &&
      url.pathname === "/repos/operator/repository/pulls"
    ) {
      return now < 60_000
        ? rateLimitedResponse(url.pathname)
        : Response.json([]);
    }
    if (
      method === "POST" &&
      url.pathname === "/repos/operator/repository/issues/17/comments"
    ) {
      operations.push("aggregate:create");
      aggregateCreates += 1;
      const requestedBody = requestBody(options)?.body;
      if (typeof requestedBody === "string") {
        aggregateBody = requestedBody;
        externalState.aggregateBody = requestedBody;
        persistExternalState();
      }
      if (now === 0 && aggregateCreates === 1) {
        throw new Error("GitHub aggregate publication connection lost");
      }
      return Response.json({ body: aggregateBody, id: 902 });
    }
    if (
      method === "GET" &&
      url.pathname === "/repos/operator/repository/issues/17/comments"
    ) {
      operations.push("aggregate:reconcile");
      return Response.json(
        aggregateBody === null ? [] : [{ body: aggregateBody, id: 902 }],
      );
    }
    if (
      method === "POST" &&
      url.pathname === "/repos/operator/repository/pulls/17/comments"
    ) {
      operations.push("inline:create");
      inlineCreates += 1;
      const payload = requestBody(options);
      if (now === 0 && inlineCreates === 1) {
        return rateLimitedResponse(url.pathname);
      }
      inlineComments.push(payload);
      persistExternalState();
      return Response.json({
        ...payload,
        id: 903 + inlineCreates,
        start_line: payload.start_line ?? null,
        start_side: payload.start_side ?? null,
      });
    }
    if (
      method === "GET" &&
      url.pathname === "/repos/operator/repository/pulls/17/comments"
    ) {
      operations.push("inline:reconcile");
      return Response.json(
        inlineComments.map((comment, index) => ({
          ...comment,
          id: 903 + index,
          start_line: comment.start_line ?? null,
          start_side: comment.start_side ?? null,
        })),
      );
    }
    if (
      method === "POST" &&
      url.pathname.startsWith("/repos/operator/repository/statuses/")
    ) {
      operations.push("commit:create");
      commitCreates += 1;
      const payload = requestBody(options);
      return Response.json({
        context: "Quality Bar",
        id: 900 + commitCreates,
        sha: url.pathname.split("/").at(-1),
        state: payload.state,
        target_url: payload.target_url,
      });
    }
    if (
      method === "GET" &&
      url.pathname.startsWith("/repos/operator/repository/commits/")
    ) {
      operations.push("commit:reconcile");
      return Response.json([]);
    }
    throw new Error(`unexpected GitHub provider route: ${url}`);
  };

  /** @type {typeof fetch} */
  const forgejoFetch = async (requestUrl, options = {}) => {
    const url = new URL(requestUrl);
    const method = options.method ?? "GET";
    if (
      method === "GET" &&
      url.pathname === "/api/v1/repos/operator/repository/pulls"
    ) {
      return now < 60_000
        ? Response.json({ message: "temporarily unavailable" }, { status: 503 })
        : Response.json([]);
    }
    if (
      method === "POST" &&
      url.pathname === "/api/v1/repos/operator/repository/issues/17/comments"
    ) {
      operations.push("aggregate:create");
      aggregateCreates += 1;
      const requestedBody = requestBody(options)?.body;
      if (typeof requestedBody === "string") {
        aggregateBody = requestedBody;
        externalState.aggregateBody = requestedBody;
        persistExternalState();
      }
      if (now === 0 && aggregateCreates === 1) {
        throw new Error("Forgejo aggregate publication connection lost");
      }
      return Response.json({ body: aggregateBody, id: 902 }, { status: 201 });
    }
    if (
      method === "GET" &&
      url.pathname === "/api/v1/repos/operator/repository/issues/17/comments"
    ) {
      operations.push("aggregate:reconcile");
      return Response.json(
        aggregateBody === null ? [] : [{ body: aggregateBody, id: 902 }],
      );
    }
    if (
      method === "POST" &&
      url.pathname === "/api/v1/repos/operator/repository/pulls/17/reviews"
    ) {
      operations.push("inline:create");
      inlineCreates += 1;
      const payload = requestBody(options);
      if (now === 0 && inlineCreates === 1) {
        return rateLimitedResponse(url.pathname, false);
      }
      inlineComments.push(payload.comments[0]);
      persistExternalState();
      return Response.json(
        { commit_id: payload.commit_id, comments_count: 1, id: 909 },
        { status: 200 },
      );
    }
    if (
      method === "GET" &&
      url.pathname === "/api/v1/repos/operator/repository/pulls/17/reviews"
    ) {
      operations.push("inline:reconcile");
      return Response.json(inlineComments.length === 0 ? [] : [{ id: 909 }]);
    }
    if (
      method === "GET" &&
      url.pathname ===
        "/api/v1/repos/operator/repository/pulls/17/reviews/909/comments"
    ) {
      return Response.json(
        inlineComments.map((comment) => ({
          ...comment,
          original_position: comment.old_position,
          position: comment.new_position,
        })),
      );
    }
    if (
      method === "POST" &&
      url.pathname.startsWith("/api/v1/repos/operator/repository/statuses/")
    ) {
      operations.push("commit:create");
      commitCreates += 1;
      const payload = requestBody(options);
      return Response.json(
        {
          context: "Quality Bar",
          description: payload.description,
          id: 900 + commitCreates,
          sha: url.pathname.split("/").at(-1),
          state: payload.state,
          target_url: payload.target_url,
        },
        { status: 201 },
      );
    }
    if (
      method === "GET" &&
      url.pathname.startsWith("/api/v1/repos/operator/repository/statuses/")
    ) {
      operations.push("commit:reconcile");
      return Response.json([]);
    }
    throw new Error(`unexpected Forgejo provider route: ${url}`);
  };

  return {
    credential: githubCredential,
    fetch: provider === "github" ? githubFetch : forgejoFetch,
  };
}
