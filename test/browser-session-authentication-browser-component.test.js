import assert from "node:assert/strict";
import { test } from "node:test";

import { startApplication } from "./browser-session-component-support.js";

/** @param {Response} response @param {string} name */
function requiredHeader(response, name) {
  const value = response.headers.get(name);
  if (!value) {
    throw new Error(`browser_authentication_header_missing: ${name}`);
  }
  return value;
}

/** @param {Response} response */
function sessionCookie(response) {
  return requiredHeader(response, "set-cookie").split(";", 1)[0];
}

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

test("the minimum unauthenticated surface exposes the password-only login and no product data", async () => {
  const { origin } = await startApplication();

  const login = await fetch(`${origin}/`);
  assert.match(requiredHeader(login, "content-type"), /^text\/html/);
  const loginPage = await login.text();
  assert.match(loginPage, /<label for="password">Password<\/label>/);
  assert.match(loginPage, /<button type="submit">Log in<\/button>/);
  assert.match(loginPage, /<script src="\/assets\/login\.js"><\/script>/);
  assert.doesNotMatch(
    loginPage,
    /username|signup|remember|recovery|localStorage|Bearer/i,
  );

  const system = await fetch(`${origin}/api/v1/system`);
  assert.equal(system.status, 401);
  assert.equal(await responseErrorCode(system), "authentication_required");
});

test("a password login sets only an HttpOnly Strict host-only cookie and logout clears it", async () => {
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
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Secure/);
  assert.doesNotMatch(cookie, /Domain=|Max-Age=|Bearer/i);

  const authenticated = await fetch(`${origin}/api/v1/system`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  assert.equal(authenticated.status, 200);

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.match(
    authenticatedHtml,
    /<button id="logout" type="button">Log out<\/button>/,
  );
  assert.match(
    authenticatedHtml,
    /<script src="\/assets\/operator\.js"><\/script>/,
  );

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
  assert.match(requiredHeader(logout, "set-cookie"), /Max-Age=0/);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/system`, {
        headers: { cookie: cookie.split(";", 1)[0], ...proxyHeaders },
      })
    ).status,
    401,
  );
});

test("the authenticated browser shell has the fixed resource navigation and a System attention target", async () => {
  const { origin } = await startApplication();
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = sessionCookie(login);

  const evaluations = await fetch(`${origin}/`, { headers: { cookie } });
  const evaluationsHtml = await evaluations.text();
  assert.match(evaluationsHtml, /<h1>Evaluations<\/h1>/);
  assert.match(evaluationsHtml, /aria-label="Primary"/);
  for (const resource of [
    "Evaluations",
    "Reviews",
    "Repositories",
    "Analytics",
    "System",
  ]) {
    assert.match(evaluationsHtml, new RegExp(`>${resource}<\\/a>`));
  }
  assert.match(evaluationsHtml, /id="attention"/);
  assert.doesNotMatch(evaluationsHtml, /Dashboard|notification|workflow/i);

  const system = await fetch(`${origin}/?view=system`, { headers: { cookie } });
  const systemHtml = await system.text();
  assert.match(systemHtml, /<h1>System<\/h1>/);
  assert.match(systemHtml, /id="system-facts"/);
  assert.match(systemHtml, /<script src="\/assets\/operator\.js"><\/script>/);

  const reviews = await fetch(`${origin}/?view=reviews`, {
    headers: { cookie },
  });
  const reviewsHtml = await reviews.text();
  assert.match(reviewsHtml, /<h1>Reviews<\/h1>/);
  assert.match(reviewsHtml, /id="review-create-form"/);
  assert.match(reviewsHtml, /id="review-criteria"/);
  assert.match(
    reviewsHtml,
    /id="review-add-criterion"[^>]*>Add another Criterion<\/button>/,
  );
  assert.match(reviewsHtml, /id="review-model"/);
  assert.match(reviewsHtml, /id="review-reasoning-effort"/);
  assert.match(reviewsHtml, /id="review-service-tier"/);
  assert.match(reviewsHtml, /<script src="\/assets\/operator\.js"><\/script>/);
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-create\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-metadata\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-criteria\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-version-contract\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-version\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-reactivation\.js"><\/script>/,
  );
  assert.match(
    reviewsHtml,
    /<script src="\/assets\/review-archival\.js"><\/script>/,
  );
  assert.match(reviewsHtml, /review-create-result/);
  assert.match(reviewsHtml, /id="review-metadata-form"/);
  assert.match(reviewsHtml, /id="review-metadata-name"/);
  assert.match(reviewsHtml, /id="review-metadata-description"/);
  assert.match(reviewsHtml, /id="review-metadata-result"/);
  assert.match(reviewsHtml, /id="review-version-form"/);
  assert.match(reviewsHtml, /id="review-version-activation"/);
  assert.match(
    reviewsHtml,
    /id="review-version-activate"[^>]*>Reactivate<\/button>/,
  );
  assert.match(reviewsHtml, /id="review-version-applicability-rule"/);
  assert.match(reviewsHtml, /id="review-version-criteria"/);
  assert.match(
    reviewsHtml,
    /id="review-version-add-criterion"[^>]*>Add Criterion<\/button>/,
  );
  assert.match(reviewsHtml, /id="review-version-result"/);
  assert.match(reviewsHtml, /id="review-archival-form"/);
  assert.match(reviewsHtml, /id="review-archival-state"/);
  assert.match(reviewsHtml, /id="review-archival-result"/);
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
  assert.match(
    safeLoginPage,
    /<script id="browser-configuration" type="application\/json">\{"intendedDestination":"\/system\?section=sessions"\}<\/script>/,
  );
  assert.match(safeLoginPage, /<script src="\/assets\/login\.js"><\/script>/);

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
  assert.match(
    authenticatedHtml,
    /<script src="\/assets\/operator\.js"><\/script>/,
  );

  const unsafeDestination = await fetch(
    `${origin}/?return_to=https%3A%2F%2Fattacker.example%2Fsteal`,
  );
  const unsafeLoginPage = await unsafeDestination.text();
  assert.match(
    unsafeLoginPage,
    /<script id="browser-configuration" type="application\/json">\{"intendedDestination":"\/"\}<\/script>/,
  );
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
  const correctPasswordError =
    /** @type {{error: {code: string, message: string, request_id: string}}} */ (
      await throttledCorrectPassword.json()
    );
  const incorrectPasswordError =
    /** @type {{error: {code: string, message: string, request_id: string}}} */ (
      await throttledIncorrectPassword.json()
    );
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
