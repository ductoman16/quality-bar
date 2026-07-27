import assert from "node:assert/strict";
import { test } from "node:test";

import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.js";

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

test("machine credentials are accepted only as a sole Authorization bearer value", async () => {
  const application = await startApplication(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const token = application.application.implementerTokens.create(password);

  const validBearer = await fetch(`${application.origin}/api/v1/system`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(validBearer.status, 403);
  assert.equal(await responseErrorCode(validBearer), "authorization_forbidden");

  for (const path of [
    "/api/v1/session/logout",
    "/api/v1/sessions/revoke",
    "/api/v1/implementer-token/rotate",
  ]) {
    const forbiddenAdministration = await fetch(
      `${application.origin}${path}`,
      {
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
      },
    );
    assert.equal(forbiddenAdministration.status, 403);
    assert.equal(
      await responseErrorCode(forbiddenAdministration),
      "authorization_forbidden",
    );
  }
  assert.equal(
    application.application.implementerTokens.hasActiveToken(),
    true,
  );

  const browserSurface = await fetch(`${application.origin}/`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(browserSurface.status, 403);
  assert.equal(
    await responseErrorCode(browserSurface),
    "authorization_forbidden",
  );

  const unauthenticatedUnknownQuery = await fetch(
    `${application.origin}/api/v1/system?unexpected=true`,
  );
  assert.equal(unauthenticatedUnknownQuery.status, 401);
  assert.equal(
    await responseErrorCode(unauthenticatedUnknownQuery),
    "authentication_required",
  );

  const forbiddenUnknownQuery = await fetch(
    `${application.origin}/api/v1/system?unexpected=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(forbiddenUnknownQuery.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenUnknownQuery),
    "authorization_forbidden",
  );

  const mixedLogin = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      cookie: "quality_bar_session=not-a-session",
    },
    method: "POST",
  });
  assert.equal(mixedLogin.status, 401);
  assert.equal(await responseErrorCode(mixedLogin), "authentication_ambiguous");

  for (const [url, headers, expectedCode] of /** @type {[
    string,
    Record<string, string>,
    string,
  ][]} */ ([
    [
      `${application.origin}/api/v1/system?ToKeN=${token}`,
      {},
      "authentication_invalid",
    ],
    [
      `${application.origin}/api/v1/system`,
      { authorization: token },
      "authentication_invalid",
    ],
    [
      `${application.origin}/api/v1/system`,
      {
        authorization: `Bearer ${token}`,
        cookie: "quality_bar_session=not-machine-auth",
      },
      "authentication_ambiguous",
    ],
  ])) {
    const response = await fetch(url, { headers });
    assert.equal(response.status, 401);
    assert.equal(await responseErrorCode(response), expectedCode);
  }
  assert.ok(
    application.application.durableCore
      .all(
        "SELECT action, channel, outcome, error_code FROM authority_attributions",
      )
      .some(
        (event) =>
          event !== undefined &&
          event.action === "authentication" &&
          event.channel === "implementer_token" &&
          event.outcome === "failure" &&
          event.error_code === "authentication_invalid",
      ),
  );
  assert.ok(
    application.application.durableCore
      .all(
        "SELECT action, channel, outcome, error_code FROM authority_attributions",
      )
      .some(
        (event) =>
          event !== undefined &&
          event.action === "authentication" &&
          event.channel === "browser_session" &&
          event.outcome === "failure" &&
          event.error_code === "authentication_ambiguous",
      ),
  );
});
