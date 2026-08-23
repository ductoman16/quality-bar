import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createBrowserSessionService } from "../src/browser-session.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import { createImplementerTokenService } from "../src/implementer-token.js";
import { recordFailedOperatorLogin } from "../src/operator/operator-login-throttle.js";
import {
  OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  bootstrapOperatorPassword,
  recoverOperatorAuthority,
  verifyOperatorPassword,
} from "../src/operator/operator-password.js";

/** @type {string[]} */
const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-authority-recovery-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("recovery revokes every browser and machine credential and clears login delay", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const originalPassword = "the original operator password";
  const replacementPassword = "the replacement operator password";
  bootstrapOperatorPassword(core, originalPassword);
  let randomByte = 0;
  const sessions = createBrowserSessionService(core, {
    now: () => 1,
    randomBytes: () => Buffer.alloc(32, ++randomByte),
  });
  const tokens = createImplementerTokenService(core, {
    randomBytes: () => Buffer.alloc(32, ++randomByte),
  });
  const firstSession = sessions.login(originalPassword);
  const secondSession = sessions.login(originalPassword);
  const token = tokens.create(originalPassword);
  recordFailedOperatorLogin(core, 1);

  recoverOperatorAuthority(core, replacementPassword, {
    now: () => 47,
    randomBytes: () => Buffer.alloc(16, 9),
  });

  assert.equal(sessions.authenticate(firstSession.secret), false);
  assert.equal(sessions.authenticate(secondSession.secret), false);
  assert.equal(tokens.authenticate(token), false);
  assert.equal(tokens.hasActiveToken(), false);
  assert.doesNotThrow(() => sessions.login(replacementPassword));
  assert.throws(
    () => verifyOperatorPassword(core, originalPassword),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "authentication_invalid",
  );
  const storedVerifier = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  )?.value;
  assert.equal(typeof storedVerifier, "string");
  assert.doesNotMatch(String(storedVerifier), /original|replacement/);
  assert.deepEqual(
    core.get(
      `SELECT channel, action, outcome, error_code, occurred_at
       FROM authority_attributions
       WHERE action = 'password_recovery'`,
    ),
    {
      action: "password_recovery",
      channel: "host",
      error_code: null,
      occurred_at: 47,
      outcome: "success",
    },
  );
  core.close();
});

test("recovery failure preserves all existing authority and throttle state", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const originalPassword = "the original operator password";
  bootstrapOperatorPassword(core, originalPassword);
  const sessions = createBrowserSessionService(core, {
    now: () => 1,
    randomBytes: () => Buffer.alloc(32, 1),
  });
  const tokens = createImplementerTokenService(core, {
    randomBytes: () => Buffer.alloc(32, 2),
  });
  const session = sessions.login(originalPassword);
  const token = tokens.create(originalPassword);
  recordFailedOperatorLogin(core, 1);

  assert.throws(
    () =>
      recoverOperatorAuthority(core, "the replacement operator password", {
        randomBytes() {
          throw new Error("randomness unavailable");
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "operator_password_verifier_unavailable",
  );

  verifyOperatorPassword(core, originalPassword);
  assert.equal(sessions.authenticate(session.secret), true);
  assert.equal(tokens.authenticate(token), true);
  assert.deepEqual(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "failed_operator_login_attempts",
    ),
    { value: "1" },
  );
  core.close();
});

test("a SQLite revocation failure rolls back the password replacement and every revocation", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const originalPassword = "the original operator password";
  bootstrapOperatorPassword(core, originalPassword);
  const sessions = createBrowserSessionService(core, {
    now: () => 1,
    randomBytes: () => Buffer.alloc(32, 3),
  });
  const tokens = createImplementerTokenService(core, {
    randomBytes: () => Buffer.alloc(32, 4),
  });
  const session = sessions.login(originalPassword);
  const token = tokens.create(originalPassword);
  recordFailedOperatorLogin(core, 1);
  core.run(`
    CREATE TRIGGER reject_authority_recovery_session_delete
    BEFORE DELETE ON browser_sessions
    BEGIN
      SELECT RAISE(ABORT, 'authority_recovery_session_delete_failed');
    END
  `);

  assert.throws(
    () => recoverOperatorAuthority(core, "the replacement operator password"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_SQLITE_ERROR" &&
      error.message === "authority_recovery_session_delete_failed",
  );

  verifyOperatorPassword(core, originalPassword);
  assert.equal(sessions.authenticate(session.secret), true);
  assert.equal(tokens.authenticate(token), true);
  assert.deepEqual(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "failed_operator_login_attempts",
    ),
    { value: "1" },
  );
  assert.equal(
    core.get(
      "SELECT id FROM authority_attributions WHERE action = 'password_recovery'",
    ),
    undefined,
  );
  core.close();
});

test("attribution failure rolls back the password replacement and every revocation", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const originalPassword = "the original operator password";
  bootstrapOperatorPassword(core, originalPassword);
  const sessions = createBrowserSessionService(core, {
    now: () => 1,
    randomBytes: () => Buffer.alloc(32, 5),
  });
  const tokens = createImplementerTokenService(core, {
    randomBytes: () => Buffer.alloc(32, 6),
  });
  const session = sessions.login(originalPassword);
  const token = tokens.create(originalPassword);
  recordFailedOperatorLogin(core, 1);
  const attributionFailure = new Error("attribution unavailable");

  assert.throws(
    () =>
      recoverOperatorAuthority(core, "the replacement operator password", {
        recordAttribution() {
          throw attributionFailure;
        },
      }),
    (error) => error === attributionFailure,
  );

  verifyOperatorPassword(core, originalPassword);
  assert.equal(sessions.authenticate(session.secret), true);
  assert.equal(tokens.authenticate(token), true);
  assert.deepEqual(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "failed_operator_login_attempts",
    ),
    { value: "1" },
  );
  core.close();
});
