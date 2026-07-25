import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { BROWSER_SESSION_COOKIE_NAME } from "./browser-session.js";

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
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

function writeError(response, status, code, message) {
  writeJson(response, status, {
    error: {
      code,
      message,
      request_id: randomUUID(),
    },
  });
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

function sessionSecret(request) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const values = cookies
    .map((cookie) => cookie.trim().split("=", 2))
    .filter(([name]) => name === BROWSER_SESSION_COOKIE_NAME)
    .map(([, value]) => value);
  return values.length === 1 ? values[0] : undefined;
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

function clearedSessionCookie(secure) {
  return [
    `${BROWSER_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function authenticationFailureStatus(code) {
  return code === "operator_password_uninitialized" ||
    code === "operator_password_verifier_unavailable" ||
    code === "session_unavailable" ||
    code === "storage_unavailable"
    ? 503
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
    storage_unavailable: "Storage is unavailable",
  }[code] ?? "Authentication is unavailable";
}

function loginPage() {
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script>
const form = document.getElementById("login-form");
const error = document.getElementById("error");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const response = await fetch("/api/v1/session/login", {
    body: JSON.stringify({ password: document.getElementById("password").value }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
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
  error.textContent = (await response.json()).error.message;
  error.hidden = false;
}
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
  error.textContent = (await response.json()).error.message;
  error.hidden = false;
});
</script>`;
}

export function createApplicationServer({
  browserSessions,
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
  ]) {
    if (typeof browserSessions?.[method] !== "function") {
      throw new TypeError("browserSessions must provide the session boundary");
    }
  }

  return createServer(async (request, response) => {
    const path = request.url.split("?", 1)[0];
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
        const { secret } = browserSessions.login(password);
        writeEmpty(response, {
          "set-cookie": sessionCookie(secret, secureBrowserCookie),
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
          );
        }
      }
      return;
    }

    if (request.method === "POST" && path === "/api/v1/session/logout") {
      try {
        browserSessions.logout(sessionSecret(request));
        writeEmpty(response, {
          "set-cookie": clearedSessionCookie(secureBrowserCookie),
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
          "set-cookie": clearedSessionCookie(secureBrowserCookie),
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
          "set-cookie": clearedSessionCookie(secureBrowserCookie),
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
        writeHtml(response, loginPage());
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
