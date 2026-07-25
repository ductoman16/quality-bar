import {
  createHash,
  randomBytes as createRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { verifyOperatorPassword } from "./operator-password.js";
import { insertAuthorityAttribution } from "./authority-attribution.js";

export const IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY =
  "implementer_token_verifier";

export class ImplementerTokenError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ImplementerTokenError";
    this.code = code;
  }
}

export function createUnavailableImplementerTokenService(error) {
  if (!error || typeof error.code !== "string") {
    throw new TypeError("an exact unavailable-token error is required");
  }
  const unavailable = () => {
    throw error;
  };
  return {
    authenticate: unavailable,
    create: unavailable,
    hasActiveToken: unavailable,
    revoke: unavailable,
    rotate: unavailable,
  };
}

function fail(code, message, cause) {
  throw new ImplementerTokenError(code, message, { cause });
}

function createToken(randomBytes) {
  let bytes;
  try {
    bytes = randomBytes(32);
  } catch (error) {
    fail("implementer_token_unavailable", "Implementer token could not be created", error);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    fail("implementer_token_unavailable", "Implementer token could not be created");
  }
  return bytes.toString("base64url");
}

function tokenVerifier(token) {
  return `sha256-v1.${createHash("sha256").update(token, "utf8").digest("base64")}`;
}

function isTokenVerifier(value) {
  return typeof value === "string" && /^sha256-v1\.[A-Za-z0-9+/]{43}=$/.test(value);
}

function verifierMatches(token, verifier) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !isTokenVerifier(verifier)
  ) {
    return false;
  }
  const candidate = Buffer.from(tokenVerifier(token), "utf8");
  const stored = Buffer.from(verifier, "utf8");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function readVerifier(reader) {
  return reader.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY,
  )?.value;
}

export function createImplementerTokenService(
  durableCore,
  { now = () => Date.now(), randomBytes = createRandomBytes, recordAttribution = insertAuthorityAttribution } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  function replace(password, requireActive) {
    let token;
    durableCore.transaction((transaction) => {
      verifyOperatorPassword(transaction, password);
      const active = readVerifier(transaction) !== undefined;
      if (active !== requireActive) {
        fail(
          active
            ? "implementer_token_already_active"
            : "implementer_token_not_active",
          active
            ? "Implementer token is already active"
            : "Implementer token is not active",
        );
      }
      token = createToken(randomBytes);
      if (active) {
        transaction.run(
          "UPDATE quality_bar_metadata SET value = ? WHERE key = ?",
          tokenVerifier(token),
          IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY,
        );
      } else {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY,
          tokenVerifier(token),
        );
      }
      recordAttribution(transaction, {
        action: requireActive ? "implementer_token_rotate" : "implementer_token_create",
        channel: "browser_session",
        occurredAt: now(),
        outcome: "success",
      });
    });
    return token;
  }

  return {
    create(password) {
      return replace(password, false);
    },
    rotate(password) {
      return replace(password, true);
    },
    revoke(password) {
      durableCore.transaction((transaction) => {
        verifyOperatorPassword(transaction, password);
        if (readVerifier(transaction) === undefined) {
          fail("implementer_token_not_active", "Implementer token is not active");
        }
        transaction.run(
          "DELETE FROM quality_bar_metadata WHERE key = ?",
          IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY,
        );
        recordAttribution(transaction, {
          action: "implementer_token_revoke",
          channel: "browser_session",
          occurredAt: now(),
          outcome: "success",
        });
      });
    },
    authenticate(token) {
      const verifier = readVerifier(durableCore);
      if (verifier !== undefined && !isTokenVerifier(verifier)) {
        fail(
          "implementer_token_verifier_unavailable",
          "Implementer token verifier could not be read",
        );
      }
      return verifierMatches(token, verifier);
    },
    hasActiveToken() {
      const verifier = readVerifier(durableCore);
      if (verifier !== undefined && !isTokenVerifier(verifier)) {
        fail(
          "implementer_token_verifier_unavailable",
          "Implementer token verifier could not be read",
        );
      }
      return verifier !== undefined;
    },
  };
}
