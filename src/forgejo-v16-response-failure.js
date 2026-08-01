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
        /** @type {number} */ (left) - /** @type {number} */ (right),
    )[0];
}

/** @param {Response} response @param {string} path @param {"publication" | "reconciliation"} operation @param {number} repositoryId */
export function forgejoV16ResponseFailure(
  response,
  path,
  operation,
  repositoryId,
) {
  const responseStatus = response.status;
  const nextAttemptAt = providerDelay(response.headers, Date.now());
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
              : "forgejo_api_request_failed";
  return Object.assign(
    new Error(
      `Forgejo ${operation} route failed with HTTP ${responseStatus}: ${path}`,
    ),
    {
      code,
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...([403, 404].includes(responseStatus) ? { repositoryId } : {}),
      responseStatus,
    },
  );
}
