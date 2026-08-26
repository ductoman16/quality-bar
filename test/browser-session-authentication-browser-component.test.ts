import assert from "node:assert/strict";
import { test } from "node:test";

import { startApplication } from "./browser-session-component-support.ts";

function requiredHeader(response: Response, name: string) {
  const value = response.headers.get(name);
  if (!value) {
    throw new Error(`browser_authentication_header_missing: ${name}`);
  }
  return value;
}

function sessionCookie(response: Response) {
  return requiredHeader(response, "set-cookie").split(";", 1)[0];
}

async function responseErrorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

function browserConfiguration(html: string) {
  const source = html.match(
    /<script id="browser-configuration" type="application\/json">\s*([^<]+)\s*<\/script>/,
  )?.[1];
  if (!source) {
    throw new Error("browser_configuration_missing");
  }
  return JSON.parse(source) as any;
}

function browserAssetPath(html: string) {
  const path = html.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
  if (!path) {
    throw new Error("browser_asset_missing");
  }
  return path;
}

test("the minimum unauthenticated surface exposes the password-only login and no product data", async () => {
  const { origin } = await startApplication();

  const login = await fetch(`${origin}/`);
  assert.match(requiredHeader(login, "content-type"), /^text\/html/);
  const loginPage = await login.text();
  assert.deepEqual(browserConfiguration(loginPage), {
    authenticated: false,
    intendedDestination: "/",
    view: "evaluations",
  });
  assert.match(loginPage, /<div id="app"><\/div>/);
  assert.match(
    browserAssetPath(loginPage),
    /^\/assets\/index-[A-Za-z0-9_-]+\.js$/,
  );
  assert.doesNotMatch(
    loginPage,
    /username|signup|remember|recovery|localStorage|Bearer/i,
  );

  const system = await fetch(`${origin}/api/v1/system`);
  assert.equal(system.status, 401);
  assert.equal(await responseErrorCode(system), "authentication_required");
});

test("the operator theme cookie is honored server-side and validated", async () => {
  const { origin } = await startApplication();
  const read = async (value: string | undefined) =>
    (
      await fetch(`${origin}/`, {
        headers: value ? { cookie: `qb_theme=${value}` } : {},
      })
    ).text();

  assert.match(await read("dark"), /<html lang="en" data-theme="dark">/);
  assert.match(await read("light"), /<html lang="en" data-theme="light">/);
  assert.match(await read("neon"), /<html lang="en">/);
  assert.match(await read(undefined), /<html lang="en">/);
});

test("a password login sets a callback-capable session cookie and strict CSRF cookie", async () => {
  const { origin } = await startApplication({
    externalOrigin: "https://quality-bar.example",
  });
  const proxyHeaders = {
    forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
  };

  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json", ...proxyHeaders },
    method: "POST",
  });
  assert.equal(login.status, 204);
  const cookie = requiredHeader(login, "set-cookie");
  assert.match(cookie, /^quality_bar_session=[A-Za-z0-9_-]{43}; Path=\//);
  const csrfToken = cookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  const authenticatedCookie = cookie.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )?.[0];
  if (!csrfToken || !authenticatedCookie) {
    throw new Error("browser_authentication_cookie_invalid");
  }
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.doesNotMatch(cookie, /Domain=|Max-Age=|Bearer/i);
  const issuedCookies = login.headers.getSetCookie();
  assert.equal(issuedCookies.length, 2);
  assert.deepEqual(
    new Set(issuedCookies.map((setCookie) => setCookie.split("=", 1)[0])),
    new Set(["quality_bar_session", "quality_bar_csrf"]),
  );
  const issuedSessionCookie = issuedCookies.find((setCookie) =>
    setCookie.startsWith("quality_bar_session="),
  );
  const issuedCsrfCookie = issuedCookies.find((setCookie) =>
    setCookie.startsWith("quality_bar_csrf="),
  );
  if (!issuedSessionCookie || !issuedCsrfCookie) {
    throw new Error("browser_authentication_cookie_names_invalid");
  }
  assert.match(issuedSessionCookie, /; SameSite=Lax/);
  assert.match(issuedCsrfCookie, /; SameSite=Strict/);

  const authenticated = await fetch(`${origin}/api/v1/system`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  assert.equal(authenticated.status, 200);

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.deepEqual(browserConfiguration(authenticatedHtml), {
    authenticated: true,
    csrfCookieName: "quality_bar_csrf",
    view: "evaluations",
  });

  const logout = await fetch(`${origin}/api/v1/session/logout`, {
    headers: {
      cookie: `${authenticatedCookie}; quality_bar_csrf=${csrfToken}`,
      origin: "https://quality-bar.example",
      "x-quality-bar-csrf": csrfToken,
      ...proxyHeaders,
    },
    method: "POST",
  });
  assert.equal(logout.status, 204);
  const clearedCookies = logout.headers.getSetCookie();
  assert.equal(clearedCookies.length, 2);
  assert.deepEqual(
    new Set(clearedCookies.map((setCookie) => setCookie.split("=", 1)[0])),
    new Set(["quality_bar_session", "quality_bar_csrf"]),
  );
  for (const setCookie of clearedCookies) {
    assert.match(setCookie, /Max-Age=0/);
  }
  const clearedSessionCookie = clearedCookies.find((setCookie) =>
    setCookie.startsWith("quality_bar_session="),
  );
  const clearedCsrfCookie = clearedCookies.find((setCookie) =>
    setCookie.startsWith("quality_bar_csrf="),
  );
  if (!clearedSessionCookie || !clearedCsrfCookie) {
    throw new Error("browser_authentication_cleared_cookie_names_invalid");
  }
  assert.match(clearedSessionCookie, /; SameSite=Lax/);
  assert.match(clearedCsrfCookie, /; SameSite=Strict/);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/system`, {
        headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
      })
    ).status,
    401,
  );
});

test("the authenticated browser shell selects each fixed resource view", async () => {
  const { origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = sessionCookie(login);

  const evaluations = await fetch(`${origin}/`, { headers: { cookie } });
  const evaluationsHtml = await evaluations.text();
  assert.equal(browserConfiguration(evaluationsHtml).view, "evaluations");

  const system = await fetch(`${origin}/?view=system`, { headers: { cookie } });
  const systemHtml = await system.text();
  assert.equal(browserConfiguration(systemHtml).view, "system");

  const reviews = await fetch(`${origin}/?view=reviews`, {
    headers: { cookie },
  });
  const reviewsHtml = await reviews.text();
  assert.equal(browserConfiguration(reviewsHtml).view, "reviews");

  const reviewDetail = await fetch(`${origin}/?view=review-detail`, {
    headers: { cookie },
  });
  const reviewDetailHtml = await reviewDetail.text();
  assert.equal(browserConfiguration(reviewDetailHtml).view, "review-detail");
});

test("a malformed login request creates no session", async () => {
  const { application, origin } = await startApplication();

  const response = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({
      password: "a correct operator password",
      unexpected: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 400);
  assert.equal(await responseErrorCode(response), "request_malformed");
  assert.equal(
    application.durableCore.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );
});

test("an expired browser session returns to login and preserves only a safe internal destination", async () => {
  const { application, origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = sessionCookie(login);
  application.durableCore.run(
    "UPDATE browser_sessions SET last_authenticated_at = 0",
  );

  const safeDestination = await fetch(
    `${origin}/?return_to=%2Fsystem%3Fsection%3Dsessions`,
    { headers: { cookie } },
  );
  const safeLoginPage = await safeDestination.text();
  assert.equal(
    browserConfiguration(safeLoginPage).intendedDestination,
    "/system?section=sessions",
  );

  const rejectedMutation = await fetch(`${origin}/api/v1/session/logout`, {
    headers: { cookie },
    method: "POST",
  });
  assert.equal(rejectedMutation.status, 401);
  const freshLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const freshCookie = sessionCookie(freshLogin);
  const operatorPage = await fetch(`${origin}/`, {
    headers: { cookie: freshCookie },
  });
  const authenticatedHtml = await operatorPage.text();
  assert.equal(browserConfiguration(authenticatedHtml).authenticated, true);

  const unsafeDestination = await fetch(
    `${origin}/?return_to=https%3A%2F%2Fattacker.example%2Fsteal`,
  );
  const unsafeLoginPage = await unsafeDestination.text();
  assert.equal(browserConfiguration(unsafeLoginPage).intendedDestination, "/");
  assert.doesNotMatch(unsafeLoginPage, /attacker\.example/);
});

test("the login surface reports one explicit throttled response without revealing password validity", async () => {
  const { origin } = await startApplication();

  const failedLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "an incorrect operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(failedLogin.status, 401);

  const throttledCorrectPassword = await fetch(
    `${origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password: "a correct operator password" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const throttledIncorrectPassword = await fetch(
    `${origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password: "another incorrect operator password" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  assert.equal(throttledCorrectPassword.status, 429);
  assert.equal(throttledCorrectPassword.headers.get("retry-after"), "1");
  assert.equal(throttledCorrectPassword.headers.get("set-cookie"), null);
  const correctPasswordError = (await throttledCorrectPassword.json()) as {
    error: { code: string; message: string; request_id: string };
  };
  const incorrectPasswordError = (await throttledIncorrectPassword.json()) as {
    error: { code: string; message: string; request_id: string };
  };
  assert.deepEqual(correctPasswordError.error, {
    code: "login_throttled",
    message: "Login is temporarily throttled",
    request_id: correctPasswordError.error.request_id,
  });
  assert.deepEqual(incorrectPasswordError.error, {
    code: "login_throttled",
    message: "Login is temporarily throttled",
    request_id: incorrectPasswordError.error.request_id,
  });
});
