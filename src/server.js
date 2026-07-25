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
    code === "login_throttle_unavailable" ||
    code === "session_unavailable" ||
    code === "storage_unavailable"
    ? 503
    : code === "login_throttled"
      ? 429
      : 401;
}

function passwordMutationFailureStatus(code) {
  return code === "operator_password_too_short" ||
    code === "session_revocation_confirmation_invalid"
    ? 422
    : authenticationFailureStatus(code);
}

function authenticationFailureMessage(code) {
  return {
    authentication_invalid: "Operator password is invalid",
    authentication_required: "Browser session is required",
    operator_password_uninitialized: "Operator password has not been bootstrapped",
    operator_password_verifier_unavailable: "Operator password verifier is unavailable",
    session_unavailable: "Browser session is unavailable",
    login_throttled: "Login is temporarily throttled",
    login_throttle_unavailable: "Login throttling is unavailable",
    storage_unavailable: "Storage is unavailable",
  }[code] ?? "Authentication is unavailable";
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
  return `<main><details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button type="submit">Revoke all sessions</button></form><button id="logout" type="button">Log out</button></details><p hidden id="error" role="alert"></p></main><script>
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
    headers: { "content-type": "application/json" },
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
document.getElementById("logout").addEventListener("click", async () => {
  error.hidden = true;
  const response = await fetch("/api/v1/session/logout", { method: "POST" });
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
  browserOrigin = null,
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
  ]) {
    if (typeof browserSessions?.[method] !== "function") {
      throw new TypeError("browserSessions must provide the session boundary");
    }
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

    if (request.method === "POST" && path === "/api/v1/session/login") {
      try {
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
        browserSessions.logout(sessionSecret(request));
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
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

    if (request.method === "POST" && path === "/api/v1/session/activity") {
      try {
        if (request.headers.origin !== browserOrigin) {
          writeError(response, 403, "origin_invalid", "Browser origin is invalid");
        } else if (
          !browserSessions.touch(
            sessionSecret(request),
            request.headers["x-quality-bar-csrf"],
          )
        ) {
          writeError(response, 401, "authentication_required", "Browser session is required");
        } else {
          writeEmpty(response);
        }
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

    if (request.method === "POST" && path === "/api/v1/session/password") {
      try {
        if (!browserSessions.authenticate(sessionSecret(request))) {
          writeError(response, 401, "authentication_required", "Browser session is required");
          return;
        }
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
            passwordMutationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/sessions/revoke") {
      try {
        if (!browserSessions.authenticate(sessionSecret(request))) {
          writeError(response, 401, "authentication_required", "Browser session is required");
          return;
        }
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
            passwordMutationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
          );
        }
      }
      return;
    }

    if (request.method === "GET" && path === "/") {
      if (!browserSessions.isBootstrapped()) {
        writeHtml(response, "<main><p role=\"status\">Operator bootstrap required</p></main>");
      } else if (browserSessions.authenticate(sessionSecret(request))) {
        writeHtml(response, operatorPage());
      } else {
        writeHtml(
          response,
          loginPage(safeInternalDestination(requestUrl.searchParams.get("return_to"))),
        );
      }
      return;
    }

    if (path === "/api/v1/operator-password/bootstrap") {
      response.writeHead(404);
      response.end();
      return;
    }

    if (isProductSurface(path)) {
      let authenticated = false;
      try {
        authenticated = browserSessions.authenticate(sessionSecret(request));
      } catch (error) {
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
        return;
      }
      if (!authenticated) {
        writeError(response, 401, "authentication_required", "Browser session is required");
        return;
      }
    }

    if (request.method === "GET" && path === "/api/v1/system") {
      writeJson(response, 200, readSystemStatus());
      return;
    }

    response.writeHead(404);
    response.end();
  });
}
