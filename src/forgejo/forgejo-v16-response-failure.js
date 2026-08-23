/** @param {Headers} headers @param {number} now */
function providerDelay(headers, now) {
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
    .filter(
      (value) =>
        Number.isSafeInteger(value) && /** @type {number} */ (value) > now,
    )
    .sort(
      (left, right) =>
        /** @type {number} */ (right) - /** @type {number} */ (left),
    )[0];
}

/** @param {Response} response @param {string} path @param {"publication" | "reconciliation" | "verification"} operation @param {number | undefined} repositoryId @param {number} [attemptedAt] */
export function forgejoV16ResponseFailure(
  response,
  path,
  operation,
  repositoryId,
  attemptedAt = Date.now(),
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

/** @param {string} path @param {Response} response @param {number | undefined} repositoryId @param {number} attemptedAt */
export async function forgejoV16ResponseJson(
  path,
  response,
  repositoryId,
  attemptedAt,
) {
  if (!response.ok) {
    if (
      ![403, 404].includes(response.status) ||
      Number.isSafeInteger(repositoryId)
    ) {
      throw forgejoV16ResponseFailure(
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
