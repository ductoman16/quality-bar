import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
  createBrowserSessionService,
  removeExpiredBrowserSessions,
} from "../src/browser-session.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";

const temporaryDirectories: string[] = [];

function sessionError(error: unknown) {
  assert.ok(error instanceof Error && "code" in error);
  return error as Error & { code: string; retryAfterSeconds?: number };
}

function storedString(
  core: ReturnType<typeof openDurableCore>,
  sql: string,
  field: string,
) {
  const value = core.get(sql)?.[field];
  if (typeof value !== "string") {
    throw new Error(`browser_session_string_missing: ${field}`);
  }
  return value;
}

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

test("storage cleanup removes only expired browser sessions", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const now = BROWSER_SESSION_ABSOLUTE_LIFETIME_MS + 10_000;
  for (const [hash, createdAt] of [
    ["expired", 0],
    ["current", now - 1_000],
  ]) {
    core.run(
      "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
      hash,
      `${hash}-csrf`,
      createdAt,
      createdAt,
    );
  }

  removeExpiredBrowserSessions(core, { now: () => now });

  assert.deepEqual(core.all("SELECT session_hash FROM browser_sessions"), [
    { session_hash: "current" },
  ]);
  core.close();
});

test("creates a durable opaque browser session without persisting its secret", () => {
  const core = openDurableCore(temporaryDatabasePath());
  bootstrapOperatorPassword(core, "a correct operator password");
  const sessions = createBrowserSessionService(core, {
    randomBytes: () => Buffer.alloc(32, 4),
  });

  const session = sessions.login("a correct operator password");

  assert.match(session.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.authenticate(session.secret), true);
  assert.notEqual(
    storedString(
      core,
      "SELECT session_hash FROM browser_sessions",
      "session_hash",
    ),
    session.secret,
  );
  assert.doesNotMatch(
    storedString(
      core,
      "SELECT session_hash FROM browser_sessions",
      "session_hash",
    ),
    new RegExp(session.secret),
  );
  assert.doesNotMatch(
    storedString(core, "SELECT csrf_hash FROM browser_sessions", "csrf_hash"),
    new RegExp(session.csrfToken),
  );
  core.close();
});

test("enforces fixed idle and absolute browser-session lifetimes from durable timestamps", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  let now = 1_000;
  const day = 24 * 60 * 60 * 1_000;
  bootstrapOperatorPassword(core, password);
  const sessions = createBrowserSessionService(core, {
    now: () => now,
    randomBytes: (() => {
      let byte = 0;
      return () => Buffer.alloc(32, ++byte);
    })(),
  });

  const idleSession = sessions.login(password);
  now += 6 * day;
  assert.equal(sessions.authenticate(idleSession.secret), true);
  assert.deepEqual(
    core.get(
      "SELECT created_at, last_authenticated_at FROM browser_sessions WHERE created_at = ?",
      1_000,
    ),
    { created_at: 1_000, last_authenticated_at: 1_000 },
  );
  now = 1_000 + 7 * day;
  assert.equal(sessions.authenticate(idleSession.secret), false);
  assert.notEqual(
    core.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );

  now = 2_000;
  const absoluteSession = sessions.login(password);
  for (const elapsedDays of [6, 12, 18, 24]) {
    now = 2_000 + elapsedDays * day;
    core.run(
      "UPDATE browser_sessions SET last_authenticated_at = ? WHERE created_at = ?",
      now,
      2_000,
    );
    assert.equal(sessions.authenticate(absoluteSession.secret), true);
  }
  now = 2_000 + 29 * day;
  core.run(
    "UPDATE browser_sessions SET last_authenticated_at = ? WHERE created_at = ?",
    now,
    2_000,
  );
  assert.equal(sessions.authenticate(absoluteSession.secret), true);
  now = 2_000 + 30 * day;
  assert.equal(sessions.authenticate(absoluteSession.secret), false);
  assert.notEqual(
    core.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );
  core.close();
});

test("refreshes idle activity only through a session-bound transition", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  let now = 1_000;
  const day = 24 * 60 * 60 * 1_000;
  bootstrapOperatorPassword(core, password);
  const sessions = createBrowserSessionService(core, {
    now: () => now,
  });
  const session = sessions.login(password);

  now += 6 * day;
  assert.equal(sessions.authenticate(session.secret), true);
  assert.equal(sessions.touch(session.secret, session.csrfToken), true);
  assert.deepEqual(
    core.get("SELECT last_authenticated_at FROM browser_sessions"),
    { last_authenticated_at: now },
  );
  now += 6 * day;
  assert.equal(sessions.authenticate(session.secret), true);
  now += 7 * day;
  assert.equal(sessions.authenticate(session.secret), false);
  core.close();
});

test("rejects an invalid password and writes no browser session", () => {
  const core = openDurableCore(temporaryDatabasePath());
  bootstrapOperatorPassword(core, "a correct operator password");
  const sessions = createBrowserSessionService(core);

  assert.throws(
    () => sessions.login("an incorrect operator password"),
    (error) => sessionError(error).code === "authentication_invalid",
  );
  assert.equal(
    core.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );
  core.close();
});

test("escalates one installation-wide failed-login delay through one minute and clears it after a successful login", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const password = "a correct operator password";
  let now = 0;
  bootstrapOperatorPassword(core, password);
  const sessions = createBrowserSessionService(core, {
    now: () => now,
  });

  for (const [attemptAt, expectedDelay] of [
    [0, 1],
    [1_000, 2],
    [3_000, 4],
    [7_000, 8],
    [15_000, 16],
    [31_000, 32],
    [63_000, 60],
  ]) {
    now = attemptAt;
    assert.throws(
      () => sessions.login("an incorrect operator password"),
      (error) => sessionError(error).code === "authentication_invalid",
    );
    assert.throws(
      () => sessions.login(password),
      (error) =>
        sessionError(error).code === "login_throttled" &&
        sessionError(error).retryAfterSeconds === expectedDelay,
    );
  }

  now = 123_000;
  assert.match(sessions.login(password).secret, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(
    () => sessions.login("an incorrect operator password"),
    (error) => sessionError(error).code === "authentication_invalid",
  );
  assert.throws(
    () => sessions.login(password),
    (error) =>
      sessionError(error).code === "login_throttled" &&
      sessionError(error).retryAfterSeconds === 1,
  );
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
    (error) =>
      sessionError(error).code === "operator_password_verifier_unavailable",
  );
  assert.equal(
    core.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );
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
  let now = 0;
  bootstrapOperatorPassword(core, currentPassword);
  const sessions = createBrowserSessionService(core, {
    now: () => now,
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
    (error) => sessionError(error).code === "authentication_invalid",
  );
  now = 1_000;
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
    (error) => sessionError(error).code === "authentication_invalid",
  );
  assert.equal(sessions.authenticate(first.secret), true);
  assert.equal(sessions.authenticate(second.secret), true);

  sessions.revokeAll(password);

  assert.equal(sessions.authenticate(first.secret), false);
  assert.equal(sessions.authenticate(second.secret), false);
  core.close();
});
