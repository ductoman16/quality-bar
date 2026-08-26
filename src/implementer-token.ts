import {
  createHash,
  randomBytes as createRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { verifyOperatorPassword } from "./operator/operator-password.ts";
import { insertAuthorityAttribution } from "./authority-attribution.ts";

export const IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY =
  "implementer_token_verifier";

export class ImplementerTokenError extends Error {
  name: "ImplementerTokenError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImplementerTokenError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new ImplementerTokenError(code, message, { cause });
}

function createToken(randomBytes: (size: number) => Buffer) {
  let bytes;
  try {
    bytes = randomBytes(32);
  } catch (error) {
    fail(
      "implementer_token_unavailable",
      "Implementer token could not be created",
      error,
    );
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    fail(
      "implementer_token_unavailable",
      "Implementer token could not be created",
    );
  }
  return bytes.toString("base64url");
}

function tokenVerifier(token: string) {
  return `sha256-v1.${createHash("sha256").update(token, "utf8").digest("base64")}`;
}

function isTokenVerifier(value: unknown): value is string {
  return (
    typeof value === "string" && /^sha256-v1\.[A-Za-z0-9+/]{43}=$/.test(value)
  );
}

function verifierMatches(token: unknown, verifier: unknown) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !isTokenVerifier(verifier)
  ) {
    return false;
  }
  const candidate = Buffer.from(tokenVerifier(token), "utf8");
  const stored = Buffer.from(verifier, "utf8");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

function readVerifier(reader: {
  get: (
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
}) {
  const row = reader.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    IMPLEMENTER_TOKEN_VERIFIER_METADATA_KEY,
  ) as { value: string } | undefined;
  return row?.value;
}

export function createImplementerTokenService(
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

  function replace(password: string, requireActive: boolean) {
    let token = "";
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
        action: requireActive
          ? "implementer_token_rotate"
          : "implementer_token_create",
        channel: "browser_session",
        occurredAt: now(),
        outcome: "success",
      });
    });
    return token;
  }

  return {
    create(password: string) {
      return replace(password, false);
    },
    rotate(password: string) {
      return replace(password, true);
    },
    revoke(password: string) {
      durableCore.transaction((transaction) => {
        verifyOperatorPassword(transaction, password);
        if (readVerifier(transaction) === undefined) {
          fail(
            "implementer_token_not_active",
            "Implementer token is not active",
          );
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
    authenticate(token: unknown) {
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
