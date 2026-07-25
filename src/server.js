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

async function readLoginRequest(request) {
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
      Object.keys(value).length !== 1 ||
      typeof value.password !== "string"
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

function logoutPage() {
  return `<main><button id="logout" type="button">Log out</button><p hidden id="error" role="alert"></p></main><script>
const error = document.getElementById("error");
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
  for (const method of ["authenticate", "isBootstrapped", "login", "logout"]) {
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

    if (request.method === "GET" && path === "/") {
      if (!browserSessions.isBootstrapped()) {
        writeHtml(response, "<main><p role=\"status\">Operator bootstrap required</p></main>");
      } else if (browserSessions.authenticate(sessionSecret(request))) {
        writeHtml(response, logoutPage());
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
