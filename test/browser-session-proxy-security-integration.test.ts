import assert from "node:assert/strict";
import { test } from "node:test";

import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";
import {
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.ts";

async function responseErrorCode(response: Response) {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

function sessionCookies(response: Response) {
  const cookies = response.headers.get("set-cookie");
  const session = cookies?.match(/quality_bar_session=[A-Za-z0-9_-]{43}/)?.[0];
  const csrf = cookies?.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/)?.[1];
  if (!session || !csrf) {
    throw new Error("proxy_security_session_cookies_missing");
  }
  return { csrf, session };
}

test("a trusted HTTPS proxy preserves authentication while direct, mixed, and identity-header requests do not bypass it", async () => {
  const application = await startApplication(temporaryDatabasePath(), {
    externalOrigin: "https://quality-bar.example",
    trustedProxyAddresses: ["127.0.0.1"],
  });
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const forwarded = "for=203.0.113.24;host=quality-bar.example;proto=https";

  const directLogin = await fetch(
    `${application.origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert.equal(directLogin.status, 400);
  assert.equal(
    await responseErrorCode(directLogin),
    "proxy_forwarded_required",
  );

  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json", forwarded },
    method: "POST",
  });
  assert.equal(login.status, 204);
  const { csrf: csrfToken, session: sessionCookie } = sessionCookies(login);
  const cookie = `${sessionCookie}; quality_bar_csrf=${csrfToken}`;

  const mixedCredentials = await fetch(
    `${application.origin}/api/v1/session/activity`,
    {
      headers: {
        authorization: "Bearer an-unimplemented-token",
        cookie,
        forwarded,
        origin: "https://quality-bar.example",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  assert.equal(mixedCredentials.status, 401);
  assert.equal(
    await responseErrorCode(mixedCredentials),
    "authentication_ambiguous",
  );

  const mixedLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: {
      authorization: "Bearer an-unimplemented-token",
      cookie,
      "content-type": "application/json",
      forwarded,
    },
    method: "POST",
  });
  assert.equal(mixedLogin.status, 401);
  assert.equal(await responseErrorCode(mixedLogin), "authentication_ambiguous");

  const duplicateSessionCookieLogin = await fetch(
    `${application.origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password }),
      headers: {
        authorization: "Bearer an-unimplemented-token",
        cookie: "quality_bar_session=first; quality_bar_session=second",
        "content-type": "application/json",
        forwarded,
      },
      method: "POST",
    },
  );
  assert.equal(duplicateSessionCookieLogin.status, 401);
  assert.equal(
    await responseErrorCode(duplicateSessionCookieLogin),
    "authentication_ambiguous",
  );

  const mixedRoot = await fetch(`${application.origin}/`, {
    headers: {
      authorization: "Bearer an-unimplemented-token",
      cookie,
      forwarded,
    },
  });
  assert.equal(mixedRoot.status, 401);
  assert.equal(await responseErrorCode(mixedRoot), "authentication_ambiguous");

  const identityHeader = await fetch(`${application.origin}/api/v1/system`, {
    headers: { forwarded, "x-remote-user": "operator" },
  });
  assert.equal(identityHeader.status, 401);
  assert.equal(
    await responseErrorCode(identityHeader),
    "authentication_required",
  );
});
