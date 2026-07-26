import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { canonicalOpenApiDocument } from "./canonical-api.js";
import { readBrowserAsset } from "./browser-assets.js";

import {
  BROWSER_CSRF_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
} from "./browser-session.js";

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function writeHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
}

function writeJavascript(response, body) {
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  response.end(body);
}

function writeEmpty(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

function writeError(response, status, code, message, headers, fields) {
  const error = {
    code,
    message,
    request_id: randomUUID(),
  };
  if (fields?.length) {
    error.fields = fields;
  }
  writeJson(
    response,
    status,
    {
      error: {
        ...error,
      },
    },
    headers,
  );
}

function isProductSurface(path) {
  return (
    path === "/" ||
    path === "/api/v1" ||
    path.startsWith("/api/v1/") ||
    path === "/mcp/v1" ||
    path.startsWith("/mcp/v1/")
  );
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const values = cookies
    .map((cookie) => cookie.trim().split("=", 2))
    .filter(([cookieName]) => cookieName === name)
    .map(([, value]) => value);
  return values.length === 1 ? values[0] : undefined;
}

function sessionSecret(request) {
  return cookieValue(request, BROWSER_SESSION_COOKIE_NAME);
}

async function readPasswordRequest(request, fields) {
  const value = await readJsonRequest(request);
  if (
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => typeof value[field] === "string")
  ) {
    throw new Error("request_malformed");
  }
  return value;
}

async function readJsonRequest(request) {
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

function readLoginRequest(request) {
  return readPasswordRequest(request, ["password"]);
}

function readPasswordChangeRequest(request) {
  return readPasswordRequest(request, ["current_password", "new_password"]);
}

function readSessionRevocationRequest(request) {
  return readPasswordRequest(request, ["confirmation", "password"]);
}

function readImplementerTokenRequest(request) {
  return readPasswordRequest(request, ["password"]);
}

function sessionCookie(secret, secure) {
  return [
    `${BROWSER_SESSION_COOKIE_NAME}=${secret}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function csrfCookie(token, secure) {
  return [
    `${BROWSER_CSRF_COOKIE_NAME}=${token}`,
    "Path=/",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function clearedSessionCookies(secure) {
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

function authenticationFailureStatus(code) {
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

function browserMutationFailureStatus(code) {
  if (code === "request_malformed") {
    return 400;
  }
  return ["csrf_invalid", "origin_invalid"].includes(code)
    ? 403
    : authenticationFailureStatus(code);
}

function passwordMutationFailureStatus(code) {
  return code === "operator_password_too_short" ||
    code === "session_revocation_confirmation_invalid"
    ? 422
    : authenticationFailureStatus(code);
}

function implementerTokenFailureStatus(code) {
  return [
    "implementer_token_already_active",
    "implementer_token_not_active",
  ].includes(code)
    ? 409
    : authenticationFailureStatus(code);
}

function isUnavailableError(error) {
  return typeof error?.code === "string" && error.code.endsWith("_unavailable");
}

function authenticationFailureMessage(code) {
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

function browserMutationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertNoMixedCredentials(request) {
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

function requireBrowserSession(browserSessions, request) {
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

function requireBrowserMutation(browserSessions, request, browserOrigin) {
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

function requireBrowserMutationWithQuery(
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

function hasUrlToken(requestUrl) {
  return [...requestUrl.searchParams.keys()].some((name) =>
    ["access_token", "authorization", "token"].includes(name.toLowerCase()),
  );
}

function requireProductAuthority(
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

function safeInternalDestination(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  try {
    const destination = new URL(value, "http://quality-bar.internal");
    if (destination.origin !== "http://quality-bar.internal") {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

function assertAllowedQueryParameters(requestUrl, allowed) {
  for (const key of requestUrl.searchParams.keys()) {
    if (!allowed.has(key) || requestUrl.searchParams.getAll(key).length !== 1) {
      throw browserMutationError("request_malformed", "Request is malformed");
    }
  }
}

function readAuthorityAttributionQuery(requestUrl) {
  assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
  return {
    cursor: requestUrl.searchParams.get("cursor") ?? undefined,
    limit: requestUrl.searchParams.get("limit") ?? undefined,
  };
}

function browserView(requestUrl) {
  const view = requestUrl.searchParams.get("view") ?? "evaluations";
  if (
    !["evaluations", "reviews", "repositories", "analytics", "system"].includes(
      view,
    )
  ) {
    throw browserMutationError("not_found", "Resource was not found");
  }
  return view;
}

function browserConfiguration(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function loginPage(intendedDestination) {
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script id="browser-configuration" type="application/json">${browserConfiguration({ intendedDestination })}</script><script src="/assets/login.js"></script>`;
}

function operatorPage({ view }) {
  const navigation = [
    "evaluations",
    "reviews",
    "repositories",
    "analytics",
    "system",
  ];
  const navigationLinks = navigation
    .map((name) => {
      const label = name[0].toUpperCase() + name.slice(1);
      return `<a${view === name ? ' aria-current="page"' : ""} href="/?view=${name}">${label}</a>`;
    })
    .join("");
  const attention = `<a hidden href="/?view=system" id="attention"></a>${
    view === "system" ? "" : "<style>details{display:none}</style>"
  }`;
  const heading = view[0].toUpperCase() + view.slice(1);
  const systemSection =
    view === "system"
      ? '<section aria-live="polite" id="system-facts"></section>'
      : "";
  const reviewSection =
    view === "reviews"
      ? '<form id="review-create-form"><label for="review-name">Name</label><input id="review-name" name="name" required type="text"><label for="review-description">Description</label><textarea id="review-description" name="description" required></textarea><ol id="review-criteria"></ol><button id="review-add-criterion" type="button">Add criterion</button><label for="review-model">Codex model</label><select id="review-model" name="model" required></select><label for="review-reasoning-effort">Reasoning effort</label><select id="review-reasoning-effort" name="reasoning_effort" required></select><label for="review-service-tier">Service tier</label><select id="review-service-tier" name="service_tier" required></select><button id="review-create-submit" type="submit">Create Review</button><output aria-live="polite" id="review-create-result"></output></form>'
      : "";
  return `<header><nav aria-label="Primary">${navigationLinks}</nav>${attention}</header><main><h1>${heading}</h1>${reviewSection}${systemSection}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button type="submit">Revoke implementer token</button></form><button id="logout" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" type="button">Done</button></dialog><p hidden id="error" role="alert"></p></main><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/operator.js"></script>`;
}
export function createApplicationServer({
  browserSessions,
  browserAssetReader = readBrowserAsset,
  implementerTokens,
  browserOrigin,
  requestSecurity,
  reviews,
  readDurableCoreStatus,
  readSystemStatus,
  listAuthorityAttributions,
  recordAuthorityAttribution,
  secureBrowserCookie = false,
} = {}) {
  if (typeof readDurableCoreStatus !== "function") {
    throw new TypeError("readDurableCoreStatus is required");
  }
  if (typeof browserAssetReader !== "function") {
    throw new TypeError("browserAssetReader must be a function");
  }
  if (typeof listAuthorityAttributions !== "function") {
    throw new TypeError("listAuthorityAttributions must be a function");
  }
  if (typeof recordAuthorityAttribution !== "function") {
    throw new TypeError("recordAuthorityAttribution must be a function");
  }
  for (const method of [
    "authenticate",
    "isBootstrapped",
    "login",
    "logout",
    "changePassword",
    "revokeAll",
    "touch",
    "verifyCsrf",
  ]) {
    if (typeof browserSessions?.[method] !== "function") {
      throw new TypeError("browserSessions must provide the session boundary");
    }
  }
  for (const method of [
    "authenticate",
    "create",
    "hasActiveToken",
    "revoke",
    "rotate",
  ]) {
    if (typeof implementerTokens?.[method] !== "function") {
      throw new TypeError("implementerTokens must provide the token boundary");
    }
  }
  if (typeof requestSecurity?.requestFacts !== "function") {
    throw new TypeError("requestSecurity must provide the request boundary");
  }
  if (typeof readSystemStatus !== "function") {
    throw new TypeError("readSystemStatus must be a function");
  }
  if (typeof reviews?.create !== "function") {
    throw new TypeError("reviews must provide the Review resource");
  }

  const handleRequest = async (request, response) => {
    const requestUrl = new URL(request.url, "http://quality-bar.internal");
    const path = requestUrl.pathname;
    if (request.method === "GET" && path === "/health/live") {
      writeJson(response, 200, { status: "live" });
      return;
    }

    const durableCoreStatus = readDurableCoreStatus();
    if (request.method === "GET" && path === "/health/ready") {
      if (durableCoreStatus.status === "ready") {
        writeJson(response, 200, { status: "ready" });
      } else {
        writeJson(response, 503, durableCoreStatus);
      }
      return;
    }

    if (isProductSurface(path) && durableCoreStatus.status !== "ready") {
      writeError(
        response,
        503,
        durableCoreStatus.error,
        "Quality Bar is not ready",
      );
      return;
    }

    try {
      requestSecurity.requestFacts(request);
    } catch (error) {
      writeError(
        response,
        error.code === "https_required" ? 403 : 400,
        error.code ?? "request_security_unavailable",
        error.message ?? "Request security is unavailable",
      );
      return;
    }

    if (hasUrlToken(requestUrl)) {
      recordAuthorityAttribution({
        action: "authentication",
        channel: "implementer_token",
        errorCode: "authentication_invalid",
        outcome: "failure",
      });
      writeError(
        response,
        401,
        "authentication_invalid",
        "Machine authentication is invalid",
      );
      return;
    }

    if (request.method === "GET" && path.startsWith("/assets/")) {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
      } catch (error) {
        writeError(
          response,
          400,
          error.code ?? "request_malformed",
          error.message ?? "Request is malformed",
        );
        return;
      }
      if (path === "/assets/operator.js") {
        try {
          requireBrowserSession(browserSessions, request);
        } catch (error) {
          writeError(
            response,
            authenticationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
          return;
        }
      }
      try {
        writeJavascript(response, browserAssetReader(path));
      } catch (error) {
        const status =
          error.code === "browser_asset_not_found"
            ? 404
            : error.code === "browser_asset_unavailable"
              ? 503
              : 500;
        writeError(
          response,
          status,
          error.code ?? "browser_asset_unavailable",
          error.message ?? "Browser asset is unavailable",
        );
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/login") {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
        assertNoMixedCredentials(request);
        const { password } = await readLoginRequest(request);
        const { csrfToken, secret } = browserSessions.login(password);
        writeEmpty(response, {
          "set-cookie": [
            sessionCookie(secret, secureBrowserCookie),
            csrfCookie(csrfToken, secureBrowserCookie),
          ],
        });
      } catch (error) {
        if (error.code === "authentication_ambiguous") {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: error.code,
            outcome: "failure",
          });
        }
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            authenticationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
            error.code === "login_throttled"
              ? { "retry-after": String(error.retryAfterSeconds) }
              : undefined,
          );
        }
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/logout") {
      try {
        browserSessions.logout(
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          ),
        );
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        recordAuthorityAttribution({
          action: "session_logout",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeError(
          response,
          browserMutationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/activity") {
      try {
        const secret = requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        if (
          !browserSessions.touch(secret, request.headers["x-quality-bar-csrf"])
        ) {
          throw browserMutationError(
            "authentication_required",
            "Browser session is required",
          );
        }
        writeEmpty(response);
      } catch (error) {
        recordAuthorityAttribution({
          action: "session_activity",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeError(
          response,
          browserMutationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/password") {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { current_password, new_password } =
          await readPasswordChangeRequest(request);
        browserSessions.changePassword(current_password, new_password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        recordAuthorityAttribution({
          action: "password_change",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            browserMutationFailureStatus(error.code) === 403
              ? 403
              : passwordMutationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/sessions/revoke") {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { confirmation, password } =
          await readSessionRevocationRequest(request);
        if (confirmation !== "REVOKE ALL SESSIONS") {
          const error = new Error(
            "Global browser-session revocation must be confirmed",
          );
          error.code = "session_revocation_confirmation_invalid";
          throw error;
        }
        browserSessions.revokeAll(password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        recordAuthorityAttribution({
          action: "session_revoke_all",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            browserMutationFailureStatus(error.code) === 403
              ? 403
              : passwordMutationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (
      request.method === "POST" &&
      [
        "/api/v1/implementer-token",
        "/api/v1/implementer-token/rotate",
        "/api/v1/implementer-token/revoke",
      ].includes(path)
    ) {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        if (path === "/api/v1/implementer-token/revoke") {
          const { password } = await readImplementerTokenRequest(request);
          implementerTokens.revoke(password);
          writeEmpty(response);
        } else {
          const { password } = await readImplementerTokenRequest(request);
          const token = path.endsWith("/rotate")
            ? implementerTokens.rotate(password)
            : implementerTokens.create(password);
          writeJson(response, path.endsWith("/rotate") ? 200 : 201, { token });
        }
      } catch (error) {
        recordAuthorityAttribution({
          action: path.endsWith("/rotate")
            ? "implementer_token_rotate"
            : path.endsWith("/revoke")
              ? "implementer_token_revoke"
              : "implementer_token_create",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            browserMutationFailureStatus(error.code) === 403
              ? 403
              : implementerTokenFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (request.method === "GET" && path === "/") {
      if (request.headers.authorization !== undefined) {
        try {
          assertNoMixedCredentials(request);
          if (!implementerTokens.authenticate(bearerToken(request))) {
            throw browserMutationError(
              "authentication_invalid",
              "Machine authentication is invalid",
            );
          }
          recordAuthorityAttribution({
            action: "authentication",
            channel: "implementer_token",
            outcome: "success",
          });
          recordAuthorityAttribution({
            action: "authorization",
            channel: "implementer_token",
            errorCode: "authorization_forbidden",
            outcome: "forbidden",
          });
          writeError(
            response,
            403,
            "authorization_forbidden",
            "Machine access is forbidden",
          );
        } catch (error) {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "implementer_token",
            errorCode: error.code ?? "authentication_unavailable",
            outcome: "failure",
          });
          writeError(
            response,
            authenticationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
        return;
      }
      if (!browserSessions.isBootstrapped()) {
        writeHtml(
          response,
          '<main><p role="status">Operator bootstrap required</p></main>',
        );
      } else {
        let view;
        try {
          view = browserView(requestUrl);
        } catch (error) {
          writeError(response, 404, error.code, error.message);
          return;
        }
        try {
          assertNoMixedCredentials(request);
          if (browserSessions.authenticate(sessionSecret(request))) {
            recordAuthorityAttribution({
              action: "authentication",
              channel: "browser_session",
              outcome: "success",
            });
            writeHtml(response, operatorPage({ view }));
          } else {
            if (sessionSecret(request) !== undefined) {
              recordAuthorityAttribution({
                action: "authentication",
                channel: "browser_session",
                errorCode: "authentication_required",
                outcome: "failure",
              });
            }
            writeHtml(
              response,
              loginPage(
                safeInternalDestination(
                  requestUrl.searchParams.get("return_to"),
                ),
              ),
            );
          }
        } catch (error) {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: error.code ?? "authentication_unavailable",
            outcome: "failure",
          });
          writeError(
            response,
            authenticationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (path === "/api/v1/operator-password/bootstrap") {
      writeError(response, 404, "not_found", "Resource was not found");
      return;
    }

    if (isProductSurface(path)) {
      try {
        const authority = requireProductAuthority(
          browserSessions,
          implementerTokens,
          request,
          requestUrl,
        );
        if (authority === "machine") {
          request.machineAuthority = true;
        }
      } catch (error) {
        recordAuthorityAttribution({
          action: "authentication",
          channel:
            request.headers.authorization !== undefined
              ? "implementer_token"
              : "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
        return;
      }
    }

    if (
      request.machineAuthority &&
      ["/api/v1/system", "/api/v1/system/authority-attributions"].includes(path)
    ) {
      recordAuthorityAttribution({
        action: "authorization",
        channel: "implementer_token",
        errorCode: "authorization_forbidden",
        outcome: "forbidden",
      });
      writeError(
        response,
        403,
        "authorization_forbidden",
        "Machine access is forbidden",
      );
      return;
    }

    if (path === "/api/v1/system/authority-attributions") {
      try {
        assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
      } catch (error) {
        writeError(response, 400, error.code, error.message);
        return;
      }
    } else if (path === "/api/v1" || path.startsWith("/api/v1/")) {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
      } catch (error) {
        writeError(response, 400, error.code, error.message);
        return;
      }
    }

    if (request.method === "GET" && path === "/api/v1/openapi.json") {
      writeJson(response, 200, canonicalOpenApiDocument());
      return;
    }

    if (request.method === "POST" && path === "/api/v1/reviews") {
      try {
        if (!request.machineAuthority) {
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          );
        }
        writeJson(
          response,
          201,
          reviews.create(await readJsonRequest(request)),
        );
      } catch (error) {
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else if (
          !request.machineAuthority &&
          [
            "csrf_invalid",
            "origin_invalid",
            "authentication_required",
          ].includes(error.code)
        ) {
          writeError(
            response,
            browserMutationFailureStatus(error.code),
            error.code,
            error.message ?? authenticationFailureMessage(error.code),
          );
        } else {
          const unavailable = isUnavailableError(error);
          const code = unavailable
            ? error.code
            : (error.code ?? "review_creation_failed");
          writeError(
            response,
            unavailable ? 503 : error.code ? 422 : 500,
            code,
            error.message ?? "Review creation failed",
          );
        }
      }
      return;
    }

    if (request.method === "GET" && path === "/api/v1/system") {
      if (request.machineAuthority) {
        recordAuthorityAttribution({
          action: "authorization",
          channel: "implementer_token",
          errorCode: "authorization_forbidden",
          outcome: "forbidden",
        });
        writeError(
          response,
          403,
          "authorization_forbidden",
          "Machine access is forbidden",
        );
        return;
      }
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        writeError(
          response,
          isUnavailableError(error) ? 503 : 500,
          isUnavailableError(error) ? error.code : "internal_error",
          isUnavailableError(error) ? error.message : "Internal server error",
        );
      }
      return;
    }

    if (
      request.method === "GET" &&
      path === "/api/v1/system/authority-attributions"
    ) {
      if (request.machineAuthority) {
        recordAuthorityAttribution({
          action: "authorization",
          channel: "implementer_token",
          errorCode: "authorization_forbidden",
          outcome: "forbidden",
        });
        writeError(
          response,
          403,
          "authorization_forbidden",
          "Machine access is forbidden",
        );
        return;
      }
      try {
        writeJson(
          response,
          200,
          listAuthorityAttributions(readAuthorityAttributionQuery(requestUrl)),
        );
      } catch (error) {
        const status = [
          "cursor_invalid",
          "page_size_invalid",
          "request_malformed",
        ].includes(error.code)
          ? 400
          : isUnavailableError(error)
            ? 503
            : 500;
        writeError(
          response,
          status,
          status === 400
            ? error.code
            : status === 503
              ? error.code
              : "internal_error",
          status === 400
            ? "Request is malformed"
            : status === 503
              ? error.message
              : "Internal server error",
        );
      }
      return;
    }

    writeError(response, 404, "not_found", "Resource was not found");
  };

  return createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const unavailable = isUnavailableError(error);
      writeError(
        response,
        unavailable ? 503 : 500,
        unavailable ? error.code : "internal_error",
        unavailable ? error.message : "Internal server error",
      );
    });
  });
}
