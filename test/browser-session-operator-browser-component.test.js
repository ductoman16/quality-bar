import assert from "node:assert/strict";
import { test } from "node:test";

import { startApplication } from "./browser-session-component-support.js";

test("the authenticated operator surface changes a password and revokes all sessions with fresh confirmation", async () => {
  const { origin } = await startApplication();
  const currentPassword = "a correct operator password";
  const replacementPassword = "a replacement operator password";
  const firstLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: currentPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const firstCookies = firstLogin.headers.get("set-cookie");
  const firstCookie = firstCookies.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )[0];
  const firstCsrfToken = firstCookies.match(
    /quality_bar_csrf=([A-Za-z0-9_-]{43})/,
  )[1];
  const secondLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: currentPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const secondCookie = secondLogin.headers.get("set-cookie").split(";", 1)[0];

  const authenticatedPage = await fetch(`${origin}/`, {
    headers: { cookie: firstCookie },
  });
  const authenticatedHtml = await authenticatedPage.text();
  assert.match(authenticatedHtml, /id="password-change-form"/);
  assert.match(
    authenticatedHtml,
    /<script src="\/assets\/operator\.js"><\/script>/,
  );
  assert.match(authenticatedHtml, /id="session-revocation-form"/);
  assert.match(authenticatedHtml, /REVOKE ALL SESSIONS/);
  assert.doesNotMatch(authenticatedHtml, /localStorage|Bearer/i);

  const passwordChange = await fetch(`${origin}/api/v1/session/password`, {
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: replacementPassword,
    }),
    headers: {
      "content-type": "application/json",
      cookie: `${firstCookie}; quality_bar_csrf=${firstCsrfToken}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": firstCsrfToken,
    },
    method: "POST",
  });
  assert.equal(passwordChange.status, 204);
  assert.match(passwordChange.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/system`, {
        headers: { cookie: firstCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/v1/system`, {
        headers: { cookie: secondCookie },
      })
    ).status,
    401,
  );

  const replacementLogin = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password: replacementPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const replacementCookies = replacementLogin.headers.get("set-cookie");
  const replacementCookie = replacementCookies.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )[0];
  const replacementCsrfToken = replacementCookies.match(
    /quality_bar_csrf=([A-Za-z0-9_-]{43})/,
  )[1];
  const revocation = await fetch(`${origin}/api/v1/sessions/revoke`, {
    body: JSON.stringify({
      confirmation: "REVOKE ALL SESSIONS",
      password: replacementPassword,
    }),
    headers: {
      "content-type": "application/json",
      cookie: `${replacementCookie}; quality_bar_csrf=${replacementCsrfToken}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": replacementCsrfToken,
    },
    method: "POST",
  });
  assert.equal(revocation.status, 204);
  assert.match(revocation.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/system`, {
        headers: { cookie: replacementCookie },
      })
    ).status,
    401,
  );
});

test("the authenticated operator surface reveals each generated implementer token once and requires fresh confirmation", async () => {
  const { origin } = await startApplication();
  const password = "a correct operator password";
  const login = await fetch(`${origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookies = login.headers.get("set-cookie");
  const sessionCookie = cookies.match(
    /quality_bar_session=[A-Za-z0-9_-]{43}/,
  )[0];
  const csrfToken = cookies.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)[1];
  const headers = {
    "content-type": "application/json",
    cookie: `${sessionCookie}; quality_bar_csrf=${csrfToken}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrfToken,
  };

  const page = await fetch(`${origin}/`, {
    headers: { cookie: sessionCookie },
  });
  const html = await page.text();
  assert.match(html, /id="implementer-token-create-form"/);
  assert.match(html, /id="implementer-token-rotate-form"/);
  assert.match(html, /id="implementer-token-revoke-form"/);
  assert.match(html, /id="implementer-token-reveal"/);
  assert.match(html, /aria-labelledby="implementer-token-reveal-title"/);
  assert.match(html, /<script src="\/assets\/operator\.js"><\/script>/);
  assert.doesNotMatch(html, /Bearer|localStorage/i);

  const created = await fetch(`${origin}/api/v1/implementer-token`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdToken = (await created.json()).token;
  assert.match(createdToken, /^[A-Za-z0-9_-]{43}$/);

  const duplicateCreate = await fetch(`${origin}/api/v1/implementer-token`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(duplicateCreate.status, 409);
  assert.equal(
    (await duplicateCreate.json()).error.code,
    "implementer_token_already_active",
  );

  const rotated = await fetch(`${origin}/api/v1/implementer-token/rotate`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(rotated.status, 200);
  assert.match((await rotated.json()).token, /^[A-Za-z0-9_-]{43}$/);

  const revoked = await fetch(`${origin}/api/v1/implementer-token/revoke`, {
    body: JSON.stringify({ password }),
    headers,
    method: "POST",
  });
  assert.equal(revoked.status, 204);
});
