/** @param {unknown} value @returns {Record<string, unknown> | null} */
function object(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {string} code @param {string} message @param {{cause?: unknown, nextAttemptAt?: number, repositoryId: number}} details @returns {never} */
function fail(code, message, details) {
  const error = Object.assign(
    new Error(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    ),
    { code, repositoryId: details.repositoryId },
  );
  if (details.nextAttemptAt !== undefined) {
    Object.assign(error, { nextAttemptAt: details.nextAttemptAt });
  }
  throw error;
}

/**
 * @param {{fetchRequest: typeof fetch, normalizeBaseUrl: (baseUrl: string) => string, now: () => number}} dependencies
 */
export function createForgejoV16PullRequestReader({
  fetchRequest,
  normalizeBaseUrl,
  now,
}) {
  if (
    typeof fetchRequest !== "function" ||
    typeof normalizeBaseUrl !== "function" ||
    typeof now !== "function"
  ) {
    throw new TypeError("Forgejo polling reader dependencies are invalid");
  }
  /**
   * @param {{baseUrl: string, token: string}} connection
   * @param {{full_name: string, id: number}} selectedRepository
   */
  return async function listPullRequests(connection, selectedRepository) {
    if (
      typeof connection?.token !== "string" ||
      connection.token.length === 0 ||
      !Number.isSafeInteger(selectedRepository?.id) ||
      selectedRepository.id <= 0 ||
      typeof selectedRepository.full_name !== "string" ||
      selectedRepository.full_name.length === 0
    ) {
      throw new TypeError("Forgejo polling request is invalid");
    }
    const attemptedAt = now();
    if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
      throw new TypeError(
        "now must return a nonnegative safe integer timestamp",
      );
    }
    const origin = normalizeBaseUrl(connection.baseUrl);
    const encoded = selectedRepository.full_name
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const observedNumbers = new Set();
    const snapshot = [];
    for (let page = 1; ; page += 1) {
      const path = `/api/v1/repos/${encoded}/pulls?state=all&page=${page}&limit=50`;
      let response;
      try {
        response = await fetchRequest(`${origin}${path}`, {
          headers: {
            accept: "application/json",
            authorization: `token ${connection.token}`,
          },
          redirect: "error",
        });
      } catch (cause) {
        fail(
          "forgejo_api_unavailable",
          `Forgejo polling route is unavailable: ${path}`,
          {
            cause,
            nextAttemptAt: attemptedAt + 60_000,
            repositoryId: selectedRepository.id,
          },
        );
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        const retrySeconds =
          retryAfter === null || !/^[1-9][0-9]*$/.test(retryAfter)
            ? null
            : Number(retryAfter);
        if (response.status === 429) {
          const maximumRetrySeconds = Math.floor(
            (Number.MAX_SAFE_INTEGER - attemptedAt) / 1000,
          );
          fail(
            "forgejo_api_rate_limited",
            "Forgejo pull-request polling was rate limited",
            {
              nextAttemptAt:
                retrySeconds !== null &&
                Number.isSafeInteger(retrySeconds) &&
                retrySeconds <= maximumRetrySeconds
                  ? attemptedAt + retrySeconds * 1000
                  : attemptedAt + 60_000,
              repositoryId: selectedRepository.id,
            },
          );
        }
        const failures = new Map([
          [
            401,
            [
              "forgejo_connection_credential_invalid",
              "Forgejo Connection credential is invalid",
            ],
          ],
          [
            403,
            [
              "forgejo_repository_permission_denied",
              "Forgejo Repository pull-request access is forbidden",
            ],
          ],
          [
            404,
            [
              "forgejo_repository_api_access_failed",
              "Forgejo Repository pull-request route was not found",
            ],
          ],
        ]);
        const definitive = failures.get(response.status);
        fail(
          definitive?.[0] ?? "forgejo_api_transient_failure",
          definitive?.[1] ??
            `Forgejo pull-request polling failed with HTTP ${response.status}`,
          {
            ...(definitive ? {} : { nextAttemptAt: attemptedAt + 60_000 }),
            repositoryId: selectedRepository.id,
          },
        );
      }
      let body;
      try {
        body = await response.json();
      } catch (cause) {
        fail(
          "forgejo_poll_response_invalid",
          "Forgejo pull-request polling response is invalid",
          { cause, repositoryId: selectedRepository.id },
        );
      }
      if (!Array.isArray(body)) {
        fail(
          "forgejo_poll_response_invalid",
          "Forgejo pull-request polling response is invalid",
          { repositoryId: selectedRepository.id },
        );
      }
      for (const candidate of body) {
        const pull = object(candidate);
        const base = object(pull?.base);
        const head = object(pull?.head);
        if (
          !pull ||
          !Number.isSafeInteger(pull.number) ||
          Number(pull.number) <= 0 ||
          observedNumbers.has(pull.number) ||
          !["closed", "open"].includes(/** @type {string} */ (pull.state)) ||
          typeof pull.draft !== "boolean" ||
          typeof pull.merged !== "boolean" ||
          (pull.merged_at !== null && typeof pull.merged_at !== "string") ||
          typeof base?.sha !== "string" ||
          !/^[0-9a-f]{40,64}$/.test(base.sha) ||
          typeof head?.sha !== "string" ||
          !/^[0-9a-f]{40,64}$/.test(head.sha)
        ) {
          fail(
            "forgejo_poll_response_invalid",
            "Forgejo pull-request polling response is invalid",
            { repositoryId: selectedRepository.id },
          );
        }
        observedNumbers.add(pull.number);
        snapshot.push(candidate);
      }
      if (body.length < 50) {
        return snapshot;
      }
    }
  };
}
