import assert from "node:assert/strict";
import { test } from "node:test";

import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.js";

test("password and global-session mutations keep durable authority unchanged after a rejected confirmation", async () => {
  const application = await startApplication(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);
  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";", 1)[0];
  const csrfMatch = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/);
  assert.ok(csrfMatch);
  const csrfToken = csrfMatch[1];

  const rejectedPasswordChange = await fetch(
    `${application.origin}/api/v1/session/password`,
    {
      body: JSON.stringify({
        current_password: "an incorrect operator password",
        new_password: "a replacement operator password",
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  assert.equal(rejectedPasswordChange.status, 401);
  const passwordChangeError = await rejectedPasswordChange.json();
  assert.deepEqual(
    passwordChangeError,
    /** @type {{ error: { code: string } }} */ (passwordChangeError),
  );
  assert.equal(passwordChangeError.error.code, "authentication_invalid");
  assert.doesNotMatch(
    JSON.stringify(passwordChangeError),
    /incorrect|replacement/,
  );

  const rejectedRevocation = await fetch(
    `${application.origin}/api/v1/sessions/revoke`,
    {
      body: JSON.stringify({ confirmation: "no", password }),
      headers: {
        "content-type": "application/json",
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  assert.equal(rejectedRevocation.status, 422);
  const revocationError = await rejectedRevocation.json();
  assert.deepEqual(
    revocationError,
    /** @type {{ error: { code: string } }} */ (revocationError),
  );
  assert.equal(
    revocationError.error.code,
    "session_revocation_confirmation_invalid",
  );
  assert.doesNotMatch(
    JSON.stringify(revocationError),
    /correct operator password/,
  );

  const authenticated = await fetch(`${application.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(authenticated.status, 200);
  const replacementLogin = await fetch(
    `${application.origin}/api/v1/session/login`,
    {
      body: JSON.stringify({ password: "a replacement operator password" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert.equal(replacementLogin.status, 401);
});
