import {
  BROWSER_CSRF_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
} from "./browser-session.js";

function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const values = cookies
    .map((cookie) => cookie.trim().split("=", 2))
    .filter(([cookieName]) => cookieName === name)
    .map(([, value]) => value);
  return values.length === 1 ? values[0] : undefined;
}

function readPasswordRequest(request, fields) {
  return readJsonRequest(request).then((value) => {
    if (
      Object.keys(value).length !== fields.length ||
      !fields.every((field) => typeof value[field] === "string")
    ) {
      throw new Error("request_malformed");
    }
    return value;
  });
}

export async function readJsonRequest(request) {
  if (request.headers["content-type"] !== "application/json") {
    throw new Error("request_malformed");
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 8 * 1024) {
      throw new Error("request_malformed");
    }
  }
  try {
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("request_malformed");
    }
    return value;
  } catch (error) {
    if (error.message === "request_malformed") {
      throw error;
    }
    throw new Error("request_malformed");
  }
}

export function readLoginRequest(request) {
  return readPasswordRequest(request, ["password"]);
}

export function readPasswordChangeRequest(request) {
  return readPasswordRequest(request, ["current_password", "new_password"]);
}

export function readSessionRevocationRequest(request) {
  return readPasswordRequest(request, ["confirmation", "password"]);
}

export function readImplementerTokenRequest(request) {
  return readPasswordRequest(request, ["password"]);
}

export function isProductSurface(path) {
  return (
    path === "/" ||
    path === "/api/v1" ||
    path.startsWith("/api/v1/") ||
    path === "/mcp/v1" ||
    path.startsWith("/mcp/v1/")
  );
}

export function sessionCookie(secret, secure) {
  return [
    `${BROWSER_SESSION_COOKIE_NAME}=${secret}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function csrfCookie(token, secure) {
  return [
    `${BROWSER_CSRF_COOKIE_NAME}=${token}`,
    "Path=/",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedSessionCookies(secure) {
  return [
    [
      `${BROWSER_SESSION_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
      ...(secure ? ["Secure"] : []),
    ].join("; "),
    [
      `${BROWSER_CSRF_COOKIE_NAME}=`,
      "Path=/",
      "SameSite=Strict",
      "Max-Age=0",
      ...(secure ? ["Secure"] : []),
    ].join("; "),
  ];
}

export function authenticationFailureStatus(code) {
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

export function browserMutationFailureStatus(code) {
  if (code === "request_malformed") {
    return 400;
  }
  return ["csrf_invalid", "origin_invalid"].includes(code)
    ? 403
    : authenticationFailureStatus(code);
}

export function passwordMutationFailureStatus(code) {
  return code === "operator_password_too_short" ||
    code === "session_revocation_confirmation_invalid"
    ? 422
    : authenticationFailureStatus(code);
}

export function implementerTokenFailureStatus(code) {
  return [
    "implementer_token_already_active",
    "implementer_token_not_active",
  ].includes(code)
    ? 409
    : authenticationFailureStatus(code);
}

export function isUnavailableError(error) {
  return typeof error?.code === "string" && error.code.endsWith("_unavailable");
}

export function authenticationFailureMessage(code) {
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

export function browserMutationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function assertNoMixedCredentials(request) {
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

export function sessionSecret(request) {
  return cookieValue(request, BROWSER_SESSION_COOKIE_NAME);
}

export function requireBrowserSession(browserSessions, request) {
  const secret = sessionSecret(request);
  assertNoMixedCredentials(request);
  if (!browserSessions.authenticate(secret)) {
    throw browserMutationError(
      "authentication_required",
      "Browser session is required",
    );
  }
  return secret;
}

export function requireBrowserMutation(
  browserSessions,
  request,
  browserOrigin,
) {
  const secret = requireBrowserSession(browserSessions, request);
  if (request.headers.origin !== browserOrigin) {
    throw browserMutationError("origin_invalid", "Browser origin is invalid");
  }
  if (
    !browserSessions.verifyCsrf(secret, request.headers["x-quality-bar-csrf"])
  ) {
    throw browserMutationError("csrf_invalid", "Browser CSRF token is invalid");
  }
  return secret;
}

export function requireBrowserMutationWithQuery(
  browserSessions,
  request,
  browserOrigin,
  requestUrl,
) {
  const secret = requireBrowserMutation(
    browserSessions,
    request,
    browserOrigin,
  );
  assertAllowedQueryParameters(requestUrl, new Set());
  return secret;
}

function bearerToken(request) {
  const value = request.headers.authorization;
  const match =
    typeof value === "string" && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  return match?.[1];
}

export function hasUrlToken(requestUrl) {
  return [...requestUrl.searchParams.keys()].some((name) =>
    ["access_token", "authorization", "token"].includes(name.toLowerCase()),
  );
}

export function requireProductAuthority(
  browserSessions,
  implementerTokens,
  request,
  requestUrl,
) {
  assertNoMixedCredentials(request);
  if (hasUrlToken(requestUrl)) {
    throw browserMutationError(
      "authentication_invalid",
      "Machine authentication is invalid",
    );
  }
  if (request.headers.authorization !== undefined) {
    if (!implementerTokens.authenticate(bearerToken(request))) {
      throw browserMutationError(
        "authentication_invalid",
        "Machine authentication is invalid",
      );
    }
    return "machine";
  }
  if (!browserSessions.authenticate(sessionSecret(request))) {
    throw browserMutationError(
      "authentication_required",
      "Browser session is required",
    );
  }
  return "operator";
}

export function assertAllowedQueryParameters(requestUrl, allowed) {
  for (const key of requestUrl.searchParams.keys()) {
    if (!allowed.has(key) || requestUrl.searchParams.getAll(key).length !== 1) {
      throw browserMutationError("request_malformed", "Request is malformed");
    }
  }
}

export function readAuthorityAttributionQuery(requestUrl) {
  assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
  return {
    cursor: requestUrl.searchParams.get("cursor") ?? undefined,
    limit: requestUrl.searchParams.get("limit") ?? undefined,
  };
}
