import {
  createHash,
  randomBytes as createRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  prepareOperatorPasswordReplacement,
  verifyOperatorPassword,
} from "./operator/operator-password.ts";
import {
  clearFailedOperatorLoginDelay,
  recordFailedOperatorLogin,
  rejectDuringFailedLoginDelay,
} from "./operator/operator-login-throttle.ts";
import { insertAuthorityAttribution } from "./authority-attribution.ts";

export const BROWSER_SESSION_COOKIE_NAME = "quality_bar_session";
export const BROWSER_CSRF_COOKIE_NAME = "quality_bar_csrf";

export const BROWSER_SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const BROWSER_SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class BrowserSessionError extends Error {
  name: "BrowserSessionError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserSessionError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new BrowserSessionError(code, message, { cause });
}

function sessionHash(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("base64");
}

function matchesHash(secret: string, hash: string) {
  const candidate = Buffer.from(sessionHash(secret), "utf8");
  const stored = Buffer.from(hash, "utf8");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

function createSessionSecret(randomBytes: (size: number) => Buffer) {
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

function currentTimestamp(now: () => number) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail("session_unavailable", "Browser session is unavailable");
  }
  return timestamp;
}

export type BrowserSessionRow = {
  created_at: number;
  csrf_hash?: string;
  last_authenticated_at: number;
};
function hasExpired(session: BrowserSessionRow, timestamp: number) {
  return (
    timestamp - session.created_at >= BROWSER_SESSION_ABSOLUTE_LIFETIME_MS ||
    timestamp - session.last_authenticated_at >=
      BROWSER_SESSION_IDLE_LIFETIME_MS
  );
}

export function removeExpiredBrowserSessions(
  durableCore: ReturnType<
    typeof import("./durable/durable-core.ts").openDurableCore
  >,
  { now = () => Date.now() }: { now?: () => number } = {},
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

export function createBrowserSessionService(
  durableCore: ReturnType<
    typeof import("./durable/durable-core.ts").openDurableCore
  >,
  {
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    recordAttribution = insertAuthorityAttribution,
  }: {
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    recordAttribution?: typeof insertAuthorityAttribution;
  } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  return {
    login(password: string) {
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
    authenticate(secret: string | undefined) {
      if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const hash = sessionHash(secret);
      const session = durableCore.get(
        "SELECT created_at, last_authenticated_at FROM browser_sessions WHERE session_hash = ?",
        hash,
      ) as BrowserSessionRow | undefined;
      return session !== undefined && !hasExpired(session, timestamp);
    },
    logout(secret: string) {
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
    touch(secret: string | undefined, csrfToken: string | undefined) {
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
        ) as BrowserSessionRow | undefined;
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
    verifyCsrf(secret: string | undefined, csrfToken: string | undefined) {
      if (
        typeof secret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
        typeof csrfToken !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)
      ) {
        return false;
      }
      const timestamp = currentTimestamp(now);
      const session = durableCore.get(
        "SELECT created_at, last_authenticated_at, csrf_hash FROM browser_sessions WHERE session_hash = ?",
        sessionHash(secret),
      ) as BrowserSessionRow | undefined;
      return Boolean(
        session &&
        !hasExpired(session, timestamp) &&
        typeof session.csrf_hash === "string" &&
        matchesHash(csrfToken, session.csrf_hash),
      );
    },
    changePassword(currentPassword: string, replacementPassword: string) {
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
    revokeAll(password: string) {
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
