import { currentIoOperationSignal } from "../io-operation-context.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function validGitObjectId(value: unknown) {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
  );
}

function oneGitObjectFormat(...values: unknown[]) {
  return (
    values.every(validGitObjectId) &&
    new Set(values.map((value) => (value as string).length)).size === 1
  );
}

function retryAfterAt(value: string | null, attemptedAt: number) {
  if (value === null) {
    return null;
  }
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    const maximumSeconds = Math.floor(
      (Number.MAX_SAFE_INTEGER - attemptedAt) / 1000,
    );
    return Number.isSafeInteger(seconds) && seconds <= maximumSeconds
      ? attemptedAt + seconds * 1000
      : null;
  }
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && timestamp >= attemptedAt
    ? timestamp
    : null;
}

function fail(
  code: string,
  message: string,
  details: {
    cause?: unknown;
    nextAttemptAt?: number;
    rateGateUntil?: number;
    repositoryId: number;
  },
): never {
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
  if (details.rateGateUntil !== undefined) {
    Object.assign(error, { rateGateUntil: details.rateGateUntil });
  }
  throw error;
}

export function createForgejoPullRequestReader({
  fetchRequest,
  normalizeBaseUrl,
  now,
}: {
  fetchRequest: typeof fetch;
  normalizeBaseUrl: (baseUrl: string) => string;
  now: () => number;
}) {
  if (
    typeof fetchRequest !== "function" ||
    typeof normalizeBaseUrl !== "function" ||
    typeof now !== "function"
  ) {
    throw new TypeError("Forgejo polling reader dependencies are invalid");
  }
  return async function listPullRequests(
    connection: { baseUrl: string; token: string },
    selectedRepository: { full_name: string; id: number },
  ) {
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
      const signal = currentIoOperationSignal();
      signal?.throwIfAborted();
      const path = `/api/v1/repos/${encoded}/pulls?state=all&page=${page}&limit=50`;
      let response;
      try {
        response = await fetchRequest(`${origin}${path}`, {
          headers: {
            accept: "application/json",
            authorization: `token ${connection.token}`,
          },
          redirect: "error",
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        if (signal?.aborted) {
          throw signal.reason;
        }
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
      signal?.throwIfAborted();
      if (!response.ok) {
        const providerNextAttemptAt = retryAfterAt(
          response.headers.get("retry-after"),
          attemptedAt,
        );
        if (response.status === 429) {
          fail(
            "forgejo_api_rate_limited",
            "Forgejo pull-request polling was rate limited",
            {
              nextAttemptAt: providerNextAttemptAt ?? attemptedAt + 60_000,
              rateGateUntil: providerNextAttemptAt ?? attemptedAt + 60_000,
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
            ...(definitive
              ? {}
              : {
                  nextAttemptAt: providerNextAttemptAt ?? attemptedAt + 60_000,
                  ...(providerNextAttemptAt === null
                    ? {}
                    : { rateGateUntil: providerNextAttemptAt }),
                }),
            repositoryId: selectedRepository.id,
          },
        );
      }
      let body;
      try {
        body = await response.json();
      } catch (cause) {
        if (signal?.aborted) {
          throw signal.reason;
        }
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
        const gitObjectsAreValid =
          oneGitObjectFormat(pull?.merge_base, head?.sha) &&
          (oneGitObjectFormat(pull?.merge_base, base?.sha) ||
            (pull?.state === "closed" && base?.sha === ""));
        if (
          !pull ||
          !Number.isSafeInteger(pull.number) ||
          Number(pull.number) <= 0 ||
          observedNumbers.has(pull.number) ||
          !["closed", "open"].includes(pull.state as string) ||
          typeof pull.draft !== "boolean" ||
          typeof pull.merged !== "boolean" ||
          !gitObjectsAreValid ||
          (pull.merged_at !== null &&
            (typeof pull.merged_at !== "string" ||
              !Number.isSafeInteger(Date.parse(pull.merged_at)))) ||
          !base ||
          !head
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
      if (body.length === 0) {
        return snapshot;
      }
    }
  };
}
