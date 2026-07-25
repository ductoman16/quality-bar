import {
  createHash,
  randomBytes as createRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  prepareOperatorPasswordReplacement,
  verifyOperatorPassword,
} from "./operator-password.js";
import {
  clearFailedOperatorLoginDelay,
  recordFailedOperatorLogin,
  rejectDuringFailedLoginDelay,
} from "./operator-login-throttle.js";

export const BROWSER_SESSION_COOKIE_NAME = "quality_bar_session";
export const BROWSER_CSRF_COOKIE_NAME = "quality_bar_csrf";

const BROWSER_SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const BROWSER_SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class BrowserSessionError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "BrowserSessionError";
    this.code = code;
  }
}

export function createUnavailableBrowserSessionService(error) {
  if (!error || typeof error.code !== "string") {
    throw new TypeError("an exact unavailable-session error is required");
  }
  const unavailable = () => {
    throw error;
  };
  return {
    authenticate: unavailable,
    isBootstrapped: unavailable,
    login: unavailable,
    logout: unavailable,
    changePassword: unavailable,
    revokeAll: unavailable,
    touch: unavailable,
  };
}

function fail(code, message, cause) {
  throw new BrowserSessionError(code, message, { cause });
}

function sessionHash(secret) {
  return createHash("sha256").update(secret, "utf8").digest("base64");
}

function matchesHash(secret, hash) {
  const candidate = Buffer.from(sessionHash(secret), "utf8");
  const stored = Buffer.from(hash, "utf8");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function createSessionSecret(randomBytes) {
  let bytes;
  try {
    bytes = randomBytes(32);
  } catch (error) {
    fail("session_unavailable", "Browser session could not be created", error);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    fail("session_unavailable", "Browser session could not be created");
  }
  return bytes.toString("base64url");
}

function currentTimestamp(now) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail("session_unavailable", "Browser session is unavailable");
  }
  return timestamp;
}

function hasExpired(session, timestamp) {
  return (
    timestamp - session.created_at >= BROWSER_SESSION_ABSOLUTE_LIFETIME_MS ||
    timestamp - session.last_authenticated_at >= BROWSER_SESSION_IDLE_LIFETIME_MS
  );
}

export function createBrowserSessionService(
  durableCore,
  { now = () => Date.now(), randomBytes = createRandomBytes } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  return {
    login(password) {
      const timestamp = currentTimestamp(now);
      rejectDuringFailedLoginDelay(durableCore, timestamp);
      try {
        verifyOperatorPassword(durableCore, password);
      } catch (error) {
        if (error?.code === "authentication_invalid") {
          recordFailedOperatorLogin(durableCore, timestamp);
        }
        throw error;
      }
      const secret = createSessionSecret(randomBytes);
      const csrfToken = createSessionSecret(randomBytes);
      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
            sessionHash(secret),
            sessionHash(csrfToken),
            timestamp,
            timestamp,
          );
          clearFailedOperatorLoginDelay(transaction);
        });
      } catch (error) {
        if (error?.code === "storage_unavailable") {
          throw error;
        }
        fail("session_unavailable", "Browser session could not be created", error);
      }
      return { csrfToken, secret };
    },
    authenticate(secret) {
      if (
        typeof secret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(secret)
      ) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const hash = sessionHash(secret);
      const session = durableCore.get(
        "SELECT created_at, last_authenticated_at FROM browser_sessions WHERE session_hash = ?",
        hash,
      );
      return Boolean(session) && !hasExpired(session, timestamp);
    },
    logout(secret) {
      if (!this.authenticate(secret)) {
        fail("authentication_required", "Browser session is required");
      }
      durableCore.transaction((transaction) => {
        transaction.run(
          "DELETE FROM browser_sessions WHERE session_hash = ?",
          sessionHash(secret),
        );
      });
    },
    touch(secret, csrfToken) {
      if (
        typeof secret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
        typeof csrfToken !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)
      ) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const hash = sessionHash(secret);
      return durableCore.transaction((transaction) => {
        const session = transaction.get(
          "SELECT created_at, last_authenticated_at, csrf_hash FROM browser_sessions WHERE session_hash = ?",
          hash,
        );
        if (!session || hasExpired(session, timestamp)) {
          return false;
        }
        if (!matchesHash(csrfToken, session.csrf_hash)) {
          return false;
        }
        transaction.run(
          "UPDATE browser_sessions SET last_authenticated_at = ? WHERE session_hash = ?",
          timestamp,
          hash,
        );
        return true;
      });
    },
    changePassword(currentPassword, replacementPassword) {
      const replacementVerifier = prepareOperatorPasswordReplacement(
        durableCore,
        currentPassword,
        replacementPassword,
      );
      durableCore.transaction((transaction) => {
        transaction.run(
          "UPDATE quality_bar_metadata SET value = ? WHERE key = ?",
          replacementVerifier,
          "operator_password_verifier",
        );
        transaction.run("DELETE FROM browser_sessions");
      });
    },
    revokeAll(password) {
      verifyOperatorPassword(durableCore, password);
      durableCore.transaction((transaction) => {
        transaction.run("DELETE FROM browser_sessions");
      });
    },
    isBootstrapped() {
      return (
        durableCore.get(
          "SELECT value FROM quality_bar_metadata WHERE key = ?",
          "operator_password_verifier",
        ) !== undefined
      );
    },
  };
}
