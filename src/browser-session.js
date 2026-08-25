import {
  createHash,
  randomBytes as createRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  prepareOperatorPasswordReplacement,
  verifyOperatorPassword,
} from "./operator/operator-password.js";
import {
  clearFailedOperatorLoginDelay,
  recordFailedOperatorLogin,
  rejectDuringFailedLoginDelay,
} from "./operator/operator-login-throttle.js";
import { insertAuthorityAttribution } from "./authority-attribution.js";

export const BROWSER_SESSION_COOKIE_NAME = "quality_bar_session";
export const BROWSER_CSRF_COOKIE_NAME = "quality_bar_csrf";

export const BROWSER_SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const BROWSER_SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class BrowserSessionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "BrowserSessionError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new BrowserSessionError(code, message, { cause });
}

/** @param {string} secret */
function sessionHash(secret) {
  return createHash("sha256").update(secret, "utf8").digest("base64");
}

/**
 * @param {string} secret
 * @param {string} hash
 */
function matchesHash(secret, hash) {
  const candidate = Buffer.from(sessionHash(secret), "utf8");
  const stored = Buffer.from(hash, "utf8");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

/** @param {(size: number) => Buffer} randomBytes */
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

/** @param {() => number} now */
function currentTimestamp(now) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail("session_unavailable", "Browser session is unavailable");
  }
  return timestamp;
}

/**
 * @typedef {{
 *   created_at: number,
 *   csrf_hash?: string,
 *   last_authenticated_at: number
 * }} BrowserSessionRow
 */
/**
 * @param {BrowserSessionRow} session
 * @param {number} timestamp
 */
function hasExpired(session, timestamp) {
  return (
    timestamp - session.created_at >= BROWSER_SESSION_ABSOLUTE_LIFETIME_MS ||
    timestamp - session.last_authenticated_at >=
      BROWSER_SESSION_IDLE_LIFETIME_MS
  );
}

/**
 * @param {ReturnType<typeof import("./durable/durable-core.js").openDurableCore>} durableCore
 * @param {{now?: () => number}} [options]
 */
export function removeExpiredBrowserSessions(
  durableCore,
  { now = () => Date.now() } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }
  const timestamp = currentTimestamp(now);
  return durableCore.transaction((transaction) =>
    transaction.run(
      `DELETE FROM browser_sessions
        WHERE created_at <= ? OR last_authenticated_at <= ?`,
      timestamp - BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
      timestamp - BROWSER_SESSION_IDLE_LIFETIME_MS,
    ),
  );
}

/**
 * @param {ReturnType<typeof import("./durable/durable-core.js").openDurableCore>} durableCore
 * @param {{
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   recordAttribution?: typeof insertAuthorityAttribution
 * }} options
 */
export function createBrowserSessionService(
  durableCore,
  {
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    recordAttribution = insertAuthorityAttribution,
  } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  return {
    /** @param {string} password */
    login(password) {
      const timestamp = currentTimestamp(now);
      try {
        rejectDuringFailedLoginDelay(durableCore, timestamp);
      } catch (error) {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "login_throttle_unavailable";
        recordAttribution(durableCore, {
          action: "authentication",
          channel: "browser_session",
          errorCode: code,
          occurredAt: timestamp,
          outcome: "failure",
        });
        throw error;
      }
      try {
        verifyOperatorPassword(durableCore, password);
      } catch (error) {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "operator_password_verifier_unavailable";
        if (code === "authentication_invalid") {
          recordFailedOperatorLogin(durableCore, timestamp);
        }
        recordAttribution(durableCore, {
          action: "authentication",
          channel: "browser_session",
          errorCode: code,
          occurredAt: timestamp,
          outcome: "failure",
        });
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
          recordAttribution(transaction, {
            action: "authentication",
            channel: "browser_session",
            occurredAt: timestamp,
            outcome: "success",
          });
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "storage_unavailable"
        ) {
          throw error;
        }
        fail(
          "session_unavailable",
          "Browser session could not be created",
          error,
        );
      }
      return { csrfToken, secret };
    },
    /** @param {string | undefined} secret */
    authenticate(secret) {
      if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const hash = sessionHash(secret);
      const session = /** @type {BrowserSessionRow | undefined} */ (
        durableCore.get(
          "SELECT created_at, last_authenticated_at FROM browser_sessions WHERE session_hash = ?",
          hash,
        )
      );
      return session !== undefined && !hasExpired(session, timestamp);
    },
    /** @param {string} secret */
    logout(secret) {
      if (!this.authenticate(secret)) {
        fail("authentication_required", "Browser session is required");
      }
      durableCore.transaction((transaction) => {
        transaction.run(
          "DELETE FROM browser_sessions WHERE session_hash = ?",
          sessionHash(secret),
        );
        recordAttribution(transaction, {
          action: "session_logout",
          channel: "browser_session",
          occurredAt: currentTimestamp(now),
          outcome: "success",
        });
      });
    },
    /**
     * @param {string | undefined} secret
     * @param {string | undefined} csrfToken
     */
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
        const session = /** @type {BrowserSessionRow | undefined} */ (
          transaction.get(
            "SELECT created_at, last_authenticated_at, csrf_hash FROM browser_sessions WHERE session_hash = ?",
            hash,
          )
        );
        if (!session || hasExpired(session, timestamp)) {
          return false;
        }
        if (
          typeof session.csrf_hash !== "string" ||
          !matchesHash(csrfToken, session.csrf_hash)
        ) {
          return false;
        }
        transaction.run(
          "UPDATE browser_sessions SET last_authenticated_at = ? WHERE session_hash = ?",
          timestamp,
          hash,
        );
        recordAttribution(transaction, {
          action: "session_activity",
          channel: "browser_session",
          occurredAt: timestamp,
          outcome: "success",
        });
        return true;
      });
    },
    /**
     * @param {string | undefined} secret
     * @param {string | undefined} csrfToken
     */
    verifyCsrf(secret, csrfToken) {
      if (
        typeof secret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
        typeof csrfToken !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)
      ) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const session = /** @type {BrowserSessionRow | undefined} */ (
        durableCore.get(
          "SELECT created_at, last_authenticated_at, csrf_hash FROM browser_sessions WHERE session_hash = ?",
          sessionHash(secret),
        )
      );
      return Boolean(
        session &&
        !hasExpired(session, timestamp) &&
        typeof session.csrf_hash === "string" &&
        matchesHash(csrfToken, session.csrf_hash),
      );
    },
    /**
     * @param {string} currentPassword
     * @param {string} replacementPassword
     */
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
        recordAttribution(transaction, {
          action: "password_change",
          channel: "browser_session",
          occurredAt: currentTimestamp(now),
          outcome: "success",
        });
      });
    },
    /** @param {string} password */
    revokeAll(password) {
      verifyOperatorPassword(durableCore, password);
      durableCore.transaction((transaction) => {
        transaction.run("DELETE FROM browser_sessions");
        recordAttribution(transaction, {
          action: "session_revoke_all",
          channel: "browser_session",
          occurredAt: currentTimestamp(now),
          outcome: "success",
        });
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
