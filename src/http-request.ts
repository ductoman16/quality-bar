import { BROWSER_SESSION_COOKIE_NAME } from "./browser-session.ts";

export type BrowserSessionAuthority = {
  authenticate: (secret: string | undefined) => boolean;
  verifyCsrf: (
    secret: string | undefined,
    token: string | undefined,
  ) => boolean;
};
export type ImplementerTokenAuthority = {
  authenticate: (token: string | undefined) => boolean;
};

function cookieValue(request: import("fastify").FastifyRequest, name: string) {
  const occurrences = (request.headers.cookie ?? "")
    .split(";")
    .filter((cookie) => cookie.trimStart().startsWith(`${name}=`)).length;
  return occurrences === 1 ? request.cookies[name] : undefined;
}

export function isProductSurface(path: string) {
  return (
    path === "/" ||
    path.startsWith("/assets/") ||
    path === "/api/v1" ||
    path.startsWith("/api/v1/") ||
    path === "/mcp/v1" ||
    path.startsWith("/mcp/v1/")
  );
}

export function authenticationFailureStatus(code: string) {
  return code === "operator_password_uninitialized" ||
    code === "operator_password_verifier_unavailable" ||
    code === "implementer_token_unavailable" ||
    code === "implementer_token_verifier_unavailable" ||
    code === "login_throttle_unavailable" ||
    code === "session_unavailable" ||
    code === "storage_unavailable"
    ? 503
    : code === "login_throttled"
      ? 429
      : 401;
}

export function browserMutationFailureStatus(code: string) {
  if (code === "request_malformed") {
    return 400;
  }
  return ["csrf_invalid", "origin_invalid"].includes(code)
    ? 403
    : authenticationFailureStatus(code);
}

export function passwordMutationFailureStatus(code: string) {
  return code === "operator_password_too_short" ||
    code === "session_revocation_confirmation_invalid"
    ? 422
    : authenticationFailureStatus(code);
}

export function implementerTokenFailureStatus(code: string) {
  return [
    "implementer_token_already_active",
    "implementer_token_not_active",
  ].includes(code)
    ? 409
    : authenticationFailureStatus(code);
}

export function isUnavailableError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code.endsWith("_unavailable") ||
      error.code === "storage_reserve_check_failed" ||
      error.code === "application_shutting_down")
  );
}

export function authenticationFailureMessage(code: string) {
  return (
    {
      authentication_invalid: "Operator password is invalid",
      authentication_ambiguous:
        "Browser and machine credentials cannot be combined",
      csrf_invalid: "Browser CSRF token is invalid",
      authentication_required: "Browser session is required",
      operator_password_uninitialized:
        "Operator password has not been bootstrapped",
      operator_password_verifier_unavailable:
        "Operator password verifier is unavailable",
      session_unavailable: "Browser session is unavailable",
      login_throttled: "Login is temporarily throttled",
      login_throttle_unavailable: "Login throttling is unavailable",
      implementer_token_already_active: "Implementer token is already active",
      implementer_token_not_active: "Implementer token is not active",
      implementer_token_unavailable: "Implementer token is unavailable",
      implementer_token_verifier_unavailable:
        "Implementer token verifier is unavailable",
      storage_unavailable: "Storage is unavailable",
    }[code] ?? "Authentication is unavailable"
  );
}

export function browserMutationError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export function assertNoMixedCredentials(
  request: import("fastify").FastifyRequest,
) {
  if (
    request.headers.cookie !== undefined &&
    request.headers.authorization !== undefined
  ) {
    throw browserMutationError(
      "authentication_ambiguous",
      "Browser and machine credentials cannot be combined",
    );
  }
}

export function sessionSecret(request: import("fastify").FastifyRequest) {
  return cookieValue(request, BROWSER_SESSION_COOKIE_NAME);
}

/**
 * The operator's explicit theme choice, persisted client-side as a cookie so
 * the server can honor it across full page loads. Validated to the two known
 * values so it is safe to place in the rendered `data-theme` attribute.
 */
export function themePreference(
  request: import("fastify").FastifyRequest,
): "dark" | "light" | undefined {
  // Return fixed literals rather than the cookie value itself, so no
  // request-derived string flows onward into the rendered document.
  const value = cookieValue(request, "qb_theme");
  if (value === "dark") {
    return "dark";
  }
  if (value === "light") {
    return "light";
  }
  return undefined;
}

export function requireBrowserSession(
  browserSessions: BrowserSessionAuthority,
  request: import("fastify").FastifyRequest,
) {
  const secret = sessionSecret(request);
  assertNoMixedCredentials(request);
  if (typeof secret !== "string" || !browserSessions.authenticate(secret)) {
    throw browserMutationError(
      "authentication_required",
      "Browser session is required",
    );
  }
  return secret;
}

export function requireBrowserMutation(
  browserSessions: BrowserSessionAuthority,
  request: import("fastify").FastifyRequest,
  browserOrigin: string,
  secret: string,
) {
  if (request.headers.origin !== browserOrigin) {
    throw browserMutationError("origin_invalid", "Browser origin is invalid");
  }
  if (
    !browserSessions.verifyCsrf(
      secret,
      typeof request.headers["x-quality-bar-csrf"] === "string"
        ? request.headers["x-quality-bar-csrf"]
        : undefined,
    )
  ) {
    throw browserMutationError("csrf_invalid", "Browser CSRF token is invalid");
  }
  return secret;
}

export function bearerToken(request: import("fastify").FastifyRequest) {
  const value = request.headers.authorization;
  const match =
    typeof value === "string"
      ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value)
      : null;
  return match?.[1];
}

export function requireImplementerTokenAuthority(
  implementerTokens: ImplementerTokenAuthority,
  request: import("fastify").FastifyRequest,
) {
  assertNoMixedCredentials(request);
  if (!implementerTokens.authenticate(bearerToken(request))) {
    throw browserMutationError(
      "authentication_invalid",
      "Machine authentication is invalid",
    );
  }
}

export function hasUrlToken(requestUrl: URL) {
  return [...requestUrl.searchParams.keys()].some((name) =>
    ["access_token", "authorization", "token"].includes(name.toLowerCase()),
  );
}

export function requireProductAuthority(
  browserSessions: BrowserSessionAuthority,
  implementerTokens: ImplementerTokenAuthority,
  onboardingTokens: { authenticate: (token: string | undefined) => unknown },
  request: import("fastify").FastifyRequest,
  requestUrl: URL,
): "machine" | "onboarding" | "operator" {
  assertNoMixedCredentials(request);
  if (hasUrlToken(requestUrl)) {
    throw browserMutationError(
      "authentication_invalid",
      "Machine authentication is invalid",
    );
  }
  if (request.headers.authorization !== undefined) {
    const token = bearerToken(request);
    if (implementerTokens.authenticate(token)) {
      return "machine";
    }
    if (onboardingTokens.authenticate(token)) {
      return "onboarding";
    }
    throw browserMutationError(
      "authentication_invalid",
      "Machine authentication is invalid",
    );
  }
  if (!browserSessions.authenticate(sessionSecret(request))) {
    throw browserMutationError(
      "authentication_required",
      "Browser session is required",
    );
  }
  return "operator";
}
