import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import {
  BROWSER_CSRF_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
} from "./browser-session.js";

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function writeHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
}

function writeEmpty(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

function writeError(response, status, code, message, headers) {
  writeJson(response, status, {
    error: {
      code,
      message,
      request_id: randomUUID(),
    },
  }, headers);
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
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      Object.keys(value).length !== fields.length ||
      !fields.every((field) => typeof value[field] === "string")
    ) {
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
  return ["implementer_token_already_active", "implementer_token_not_active"].includes(
    code,
  )
    ? 409
    : authenticationFailureStatus(code);
}

function authenticationFailureMessage(code) {
  return {
    authentication_invalid: "Operator password is invalid",
    authentication_ambiguous: "Browser and machine credentials cannot be combined",
    csrf_invalid: "Browser CSRF token is invalid",
    authentication_required: "Browser session is required",
    operator_password_uninitialized: "Operator password has not been bootstrapped",
    operator_password_verifier_unavailable: "Operator password verifier is unavailable",
    session_unavailable: "Browser session is unavailable",
    login_throttled: "Login is temporarily throttled",
    login_throttle_unavailable: "Login throttling is unavailable",
    implementer_token_already_active: "Implementer token is already active",
    implementer_token_not_active: "Implementer token is not active",
    implementer_token_unavailable: "Implementer token is unavailable",
    implementer_token_verifier_unavailable: "Implementer token verifier is unavailable",
    storage_unavailable: "Storage is unavailable",
  }[code] ?? "Authentication is unavailable";
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
    throw browserMutationError("authentication_required", "Browser session is required");
  }
  return secret;
}

function requireBrowserMutation(browserSessions, request, browserOrigin) {
  const secret = requireBrowserSession(browserSessions, request);
  if (request.headers.origin !== browserOrigin) {
    throw browserMutationError("origin_invalid", "Browser origin is invalid");
  }
  if (!browserSessions.verifyCsrf(secret, request.headers["x-quality-bar-csrf"])) {
    throw browserMutationError("csrf_invalid", "Browser CSRF token is invalid");
  }
  return secret;
}

function bearerToken(request) {
  const value = request.headers.authorization;
  const match = typeof value === "string" && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  return match?.[1];
}

function hasUrlToken(requestUrl) {
  return [...requestUrl.searchParams.keys()].some((name) =>
    ["access_token", "authorization", "token"].includes(name.toLowerCase()),
  );
}

function requireProductAuthority(browserSessions, implementerTokens, request, requestUrl) {
  assertNoMixedCredentials(request);
  if (hasUrlToken(requestUrl)) {
    throw browserMutationError("authentication_invalid", "Machine authentication is invalid");
  }
  if (request.headers.authorization !== undefined) {
    if (!implementerTokens.authenticate(bearerToken(request))) {
      throw browserMutationError("authentication_invalid", "Machine authentication is invalid");
    }
    return "machine";
  }
  if (!browserSessions.authenticate(sessionSecret(request))) {
    throw browserMutationError("authentication_required", "Browser session is required");
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

function loginPage(intendedDestination) {
  const safeDestination = JSON.stringify(intendedDestination).replaceAll(
    "<",
    "\\u003c",
  );
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script>
const form = document.getElementById("login-form");
const error = document.getElementById("error");
const intendedDestination = ${safeDestination};
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const response = await fetch("/api/v1/session/login", {
    body: JSON.stringify({ password: document.getElementById("password").value }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    location.assign(intendedDestination);
    return;
  }
  error.textContent = (await response.json()).error.message;
  error.hidden = false;
});
</script>`;
}

function operatorPage() {
  return `<main><details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button type="submit">Revoke implementer token</button></form><button id="logout" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" type="button">Done</button></dialog><p hidden id="error" role="alert"></p></main><script>
const error = document.getElementById("error");
let lastActivityAt = 0;
function csrfToken() {
  return document.cookie.split(";").map((cookie) => cookie.trim().split("=", 2)).find(([name]) => name === "${BROWSER_CSRF_COOKIE_NAME}")?.[1];
}
async function returnToLoginAfterAuthenticationFailure(response) {
  if (response.status !== 401) {
    return null;
  }
  const body = await response.json();
  if (body.error.code !== "authentication_required") {
    return body;
  }
  location.assign("/?return_to=" + encodeURIComponent(location.pathname + location.search));
  return true;
}
async function submitPasswordMutation(path, body) {
  error.hidden = true;
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(),
    },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
    return;
  }
  const authenticationFailure = await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (authenticationFailure ?? await response.json()).error.message;
  error.hidden = false;
}
async function submitImplementerTokenMutation(path, body) {
  error.hidden = true;
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(),
    },
    method: "POST",
  });
  if (response.ok) {
    const token = (await response.json()).token;
    if (typeof token === "string") {
      document.getElementById("implementer-token-value").textContent = token;
      document.getElementById("implementer-token-reveal").showModal();
    }
    return;
  }
  const authenticationFailure = await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (authenticationFailure ?? await response.json()).error.message;
  error.hidden = false;
}
async function recordBrowserActivity() {
  const now = Date.now();
  if (now - lastActivityAt < 60_000) {
    return;
  }
  lastActivityAt = now;
  const response = await fetch("/api/v1/session/activity", {
    headers: { "x-quality-bar-csrf": csrfToken() },
    method: "POST",
  });
  if (response.ok) {
    return;
  }
  const authenticationFailure = await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (authenticationFailure ?? await response.json()).error.message;
  error.hidden = false;
}
document.addEventListener("keydown", recordBrowserActivity);
document.addEventListener("pointerdown", recordBrowserActivity);
document.getElementById("password-change-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitPasswordMutation("/api/v1/session/password", {
    current_password: document.getElementById("password-change-current-password").value,
    new_password: document.getElementById("password-change-new-password").value,
  });
});
document.getElementById("session-revocation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitPasswordMutation("/api/v1/sessions/revoke", {
    confirmation: document.getElementById("session-revocation-confirmation").value,
    password: document.getElementById("session-revocation-password").value,
  });
});
document.getElementById("implementer-token-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitImplementerTokenMutation("/api/v1/implementer-token", {
    password: document.getElementById("implementer-token-create-password").value,
  });
});
document.getElementById("implementer-token-rotate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitImplementerTokenMutation("/api/v1/implementer-token/rotate", {
    password: document.getElementById("implementer-token-rotate-password").value,
  });
});
document.getElementById("implementer-token-revoke-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.confirm("Revoke implementer token? Machine access will remain disabled until a new token is created.")) {
    return;
  }
  await submitPasswordMutation("/api/v1/implementer-token/revoke", {
    password: document.getElementById("implementer-token-revoke-password").value,
  });
});
document.getElementById("implementer-token-reveal-close").addEventListener("click", () => {
  document.getElementById("implementer-token-reveal").close();
});
document.getElementById("implementer-token-reveal").addEventListener("close", () => {
  document.getElementById("implementer-token-value").textContent = "";
});
document.getElementById("logout").addEventListener("click", async () => {
  error.hidden = true;
  const response = await fetch("/api/v1/session/logout", {
    headers: { "x-quality-bar-csrf": csrfToken() },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
    return;
  }
  const authenticationFailure = await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (authenticationFailure ?? await response.json()).error.message;
  error.hidden = false;
});
</script>`;
}

export function createApplicationServer({
  browserSessions,
  implementerTokens,
  browserOrigin,
  requestSecurity,
  readDurableCoreStatus,
  readSystemStatus = () => ({}),
  secureBrowserCookie = false,
} = {}) {
  if (typeof readDurableCoreStatus !== "function") {
    throw new TypeError("readDurableCoreStatus is required");
  }
  if (typeof readSystemStatus !== "function") {
    throw new TypeError("readSystemStatus must be a function");
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
  for (const method of ["authenticate", "create", "hasActiveToken", "revoke", "rotate"]) {
    if (typeof implementerTokens?.[method] !== "function") {
      throw new TypeError("implementerTokens must provide the token boundary");
    }
  }
  if (typeof requestSecurity?.requestFacts !== "function") {
    throw new TypeError("requestSecurity must provide the request boundary");
  }

  return createServer(async (request, response) => {
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
      writeJson(response, 503, { error: durableCoreStatus.error });
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
      writeError(response, 401, "authentication_invalid", "Machine authentication is invalid");
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/login") {
      try {
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
        if (error.message === "request_malformed") {
          writeError(response, 400, "request_malformed", "Request is malformed");
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
        browserSessions.logout(requireBrowserMutation(browserSessions, request, browserOrigin));
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
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
        const secret = requireBrowserMutation(browserSessions, request, browserOrigin);
        if (!browserSessions.touch(secret, request.headers["x-quality-bar-csrf"])) {
          throw browserMutationError("authentication_required", "Browser session is required");
        }
        writeEmpty(response);
      } catch (error) {
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
        requireBrowserMutation(browserSessions, request, browserOrigin);
        const { current_password, new_password } =
          await readPasswordChangeRequest(request);
        browserSessions.changePassword(current_password, new_password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        if (error.message === "request_malformed") {
          writeError(response, 400, "request_malformed", "Request is malformed");
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
        requireBrowserMutation(browserSessions, request, browserOrigin);
        const { confirmation, password } =
          await readSessionRevocationRequest(request);
        if (confirmation !== "REVOKE ALL SESSIONS") {
          const error = new Error("Global browser-session revocation must be confirmed");
          error.code = "session_revocation_confirmation_invalid";
          throw error;
        }
        browserSessions.revokeAll(password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        if (error.message === "request_malformed") {
          writeError(response, 400, "request_malformed", "Request is malformed");
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
        requireBrowserMutation(browserSessions, request, browserOrigin);
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
        if (error.message === "request_malformed") {
          writeError(response, 400, "request_malformed", "Request is malformed");
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
          writeError(response, 403, "authorization_forbidden", "Machine access is forbidden");
        } catch (error) {
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
        writeHtml(response, "<main><p role=\"status\">Operator bootstrap required</p></main>");
      } else {
        try {
          assertNoMixedCredentials(request);
          if (browserSessions.authenticate(sessionSecret(request))) {
            writeHtml(response, operatorPage());
          } else {
            writeHtml(
              response,
              loginPage(safeInternalDestination(requestUrl.searchParams.get("return_to"))),
            );
          }
        } catch (error) {
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
      response.writeHead(404);
      response.end();
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
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
        return;
      }
    }

    if (request.method === "GET" && path === "/api/v1/system") {
      if (request.machineAuthority) {
        writeError(response, 403, "authorization_forbidden", "Machine access is forbidden");
        return;
      }
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "system_unavailable",
          error.message ?? "System is unavailable",
        );
      }
      return;
    }

    response.writeHead(404);
    response.end();
  });
}
