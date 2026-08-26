function providerDelay(headers: Headers, now: number) {
  const retryAfter = headers.get("retry-after");
  const rateReset = headers.get("x-ratelimit-reset");
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
  return [retryAfterAt, rateResetAt]
    .filter((value) => Number.isSafeInteger(value) && (value as number) > now)
    .sort((left, right) => (right as number) - (left as number))[0];
}

export function forgejoResponseFailure(
  response: Response,
  path: string,
  operation: "publication" | "reconciliation" | "verification",
  repositoryId: number | undefined,
  attemptedAt: number = Date.now(),
) {
  const responseStatus = response.status;
  const nextAttemptAt = providerDelay(response.headers, attemptedAt);
  const code =
    responseStatus === 401
      ? "forgejo_connection_credential_invalid"
      : responseStatus === 403
        ? "forgejo_repository_permission_denied"
        : responseStatus === 404
          ? "forgejo_repository_api_access_failed"
          : responseStatus === 429
            ? "forgejo_api_rate_limited"
            : [408, 425].includes(responseStatus) || responseStatus >= 500
              ? "forgejo_api_transient_failure"
              : operation === "verification" && responseStatus >= 400
                ? Number.isSafeInteger(repositoryId)
                  ? "forgejo_repository_capability_missing"
                  : "forgejo_required_route_unavailable"
                : "forgejo_api_request_failed";
  return Object.assign(
    new Error(
      `Forgejo ${operation} route failed with HTTP ${responseStatus}: ${path}`,
    ),
    {
      code,
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...(Number.isSafeInteger(repositoryId) &&
      (operation === "verification" || [403, 404].includes(responseStatus))
        ? { repositoryId }
        : {}),
      responseStatus,
    },
  );
}

export async function forgejoResponseJson(
  path: string,
  response: Response,
  repositoryId: number | undefined,
  attemptedAt: number,
) {
  if (!response.ok) {
    if (
      ![403, 404].includes(response.status) ||
      Number.isSafeInteger(repositoryId)
    ) {
      throw forgejoResponseFailure(
        response,
        path,
        "verification",
        repositoryId,
        attemptedAt,
      );
    }
    throw Object.assign(
      new Error(`Forgejo required route is unavailable: ${path}`),
      { code: "forgejo_required_route_unavailable" },
    );
  }
  try {
    return await response.json();
  } catch (cause) {
    throw Object.assign(
      new Error(`Forgejo response is invalid: ${path}`, { cause }),
      {
        code: "forgejo_api_response_invalid",
      },
    );
  }
}
