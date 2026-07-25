import {
  createHash,
  randomBytes as createRandomBytes,
} from "node:crypto";

import { verifyOperatorPassword } from "./operator-password.js";

export const BROWSER_SESSION_COOKIE_NAME = "quality_bar_session";

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
  };
}

function fail(code, message, cause) {
  throw new BrowserSessionError(code, message, { cause });
}

function sessionHash(secret) {
  return createHash("sha256").update(secret, "utf8").digest("base64");
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

export function createBrowserSessionService(
  durableCore,
  { randomBytes = createRandomBytes } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  return {
    login(password) {
      verifyOperatorPassword(durableCore, password);
      const secret = createSessionSecret(randomBytes);
      try {
        durableCore.transaction((transaction) => {
          transaction.run(
            "INSERT INTO browser_sessions (session_hash) VALUES (?)",
            sessionHash(secret),
          );
        });
      } catch (error) {
        if (error?.code === "storage_unavailable") {
          throw error;
        }
        fail("session_unavailable", "Browser session could not be created", error);
      }
      return { secret };
    },
    authenticate(secret) {
      return (
        typeof secret === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(secret) &&
        durableCore.get(
          "SELECT session_hash FROM browser_sessions WHERE session_hash = ?",
          sessionHash(secret),
        ) !== undefined
      );
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
