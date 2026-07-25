import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  createBrowserSessionService,
  createUnavailableBrowserSessionService,
} from "../src/browser-session.js";
import { openDurableCore } from "../src/durable-core.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";

const temporaryDirectories = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-session-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an unavailable browser-session boundary preserves the exact startup failure", () => {
  const failure = new Error("Configuration is unavailable");
  failure.code = "configuration_missing";
  const sessions = createUnavailableBrowserSessionService(failure);

  for (const method of [
    "authenticate",
    "isBootstrapped",
    "login",
    "logout",
    "changePassword",
    "revokeAll",
  ]) {
    assert.throws(() => sessions[method](), (error) => error === failure);
  }
});

test("creates a durable opaque browser session without persisting its secret", () => {
  const core = openDurableCore(temporaryDatabasePath());
  bootstrapOperatorPassword(core, "a correct operator password");
  const sessions = createBrowserSessionService(core, {
    randomBytes: () => Buffer.alloc(32, 4),
  });

  const session = sessions.login("a correct operator password");

  assert.match(session.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.authenticate(session.secret), true);
  assert.notEqual(
    core.get("SELECT session_hash FROM browser_sessions").session_hash,
    session.secret,
  );
  assert.doesNotMatch(
    core.get("SELECT session_hash FROM browser_sessions").session_hash,
    new RegExp(session.secret),
  );
  core.close();
});

test("rejects an invalid password and writes no browser session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  bootstrapOperatorPassword(core, "a correct operator password");
  const sessions = createBrowserSessionService(core);

  assert.throws(
    () => sessions.login("an incorrect operator password"),
    (error) => error.code === "authentication_invalid",
  );
  assert.equal(core.get("SELECT session_hash FROM browser_sessions"), undefined);
  core.close();
});

test("a malformed password verifier is an exact hard failure and creates no session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  core.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "operator_password_verifier",
    "not-a-password-verifier",
  );
  const sessions = createBrowserSessionService(core);

  assert.throws(
    () => sessions.login("a correct operator password"),
    (error) => error.code === "operator_password_verifier_unavailable",
  );
  assert.equal(core.get("SELECT session_hash FROM browser_sessions"), undefined);
  core.close();
});

test("logout revokes only the current durable browser session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  bootstrapOperatorPassword(core, "a correct operator password");
  const sessions = createBrowserSessionService(core, {
    randomBytes: (() => {
      let byte = 0;
      return () => Buffer.alloc(32, ++byte);
    })(),
  });
  const first = sessions.login("a correct operator password");
  const second = sessions.login("a correct operator password");

  sessions.logout(first.secret);

  assert.equal(sessions.authenticate(first.secret), false);
  assert.equal(sessions.authenticate(second.secret), true);
  core.close();
});

test("changing the password with fresh confirmation atomically revokes every browser session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const currentPassword = "a correct operator password";
  const replacementPassword = "a replacement operator password";
  bootstrapOperatorPassword(core, currentPassword);
  const sessions = createBrowserSessionService(core, {
    randomBytes: (() => {
      let byte = 0;
      return () => Buffer.alloc(32, ++byte);
    })(),
  });
  const first = sessions.login(currentPassword);
  const second = sessions.login(currentPassword);

  sessions.changePassword(currentPassword, replacementPassword);

  assert.equal(sessions.authenticate(first.secret), false);
  assert.equal(sessions.authenticate(second.secret), false);
  assert.throws(
    () => sessions.login(currentPassword),
    (error) => error.code === "authentication_invalid",
  );
  assert.equal(sessions.login(replacementPassword).secret.length, 43);
  core.close();
});

test("global session revocation requires the current password and invalidates every session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  bootstrapOperatorPassword(core, password);
  const sessions = createBrowserSessionService(core, {
    randomBytes: (() => {
      let byte = 0;
      return () => Buffer.alloc(32, ++byte);
    })(),
  });
  const first = sessions.login(password);
  const second = sessions.login(password);

  assert.throws(
    () => sessions.revokeAll("an incorrect operator password"),
    (error) => error.code === "authentication_invalid",
  );
  assert.equal(sessions.authenticate(first.secret), true);
  assert.equal(sessions.authenticate(second.secret), true);

  sessions.revokeAll(password);

  assert.equal(sessions.authenticate(first.secret), false);
  assert.equal(sessions.authenticate(second.secret), false);
  core.close();
});
