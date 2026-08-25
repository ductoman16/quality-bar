import {
  createHash,
  randomBytes as createRandomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { insertAuthorityAttribution } from "./authority-attribution.js";
import { normalizePublicRepositoryUrl } from "./repository/repository-validation.js";

const TOKEN_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;

export class OnboardingTokenError extends Error {
  /** @param {string} code @param {string} message @param {ErrorOptions} [options] */
  constructor(code, message, options) {
    super(message, options);
    this.name = "OnboardingTokenError";
    this.code = code;
  }
}

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
function fail(code, message, cause) {
  throw new OnboardingTokenError(code, message, { cause });
}

/** @param {string} token */
function verifier(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

/** @param {unknown} token @param {unknown} stored */
function matches(token, stored) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    typeof stored !== "string"
  ) {
    return false;
  }
  const candidate = verifier(token);
  const expected = Buffer.from(stored, "base64");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

/** @param {(size: number) => Buffer} randomBytes */
function createToken(randomBytes) {
  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    fail(
      "onboarding_token_unavailable",
      "Onboarding token could not be created",
    );
  }
  return bytes.toString("base64url");
}

/** @param {Record<string, import("node:sqlite").SQLInputValue>} row */
function publicToken(row) {
  return {
    id: row.id,
    repository_url: row.repository_url,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

export function createOnboardingTokenService(
  /** @type {ReturnType<typeof import("./durable/durable-core.js").openDurableCore>} */
  durableCore,
  /** @type {{
   *   now?: () => number,
   *   randomBytes?: (size: number) => Buffer,
   *   createId?: () => string,
   *   registerSecret?: (secret: string) => unknown,
   *   recordAttribution?: typeof insertAuthorityAttribution
   * }} */
  {
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    createId = randomUUID,
    registerSecret = () => {},
    recordAttribution = insertAuthorityAttribution,
  } = {},
) {
  if (!durableCore) {
    throw new TypeError("durableCore is required");
  }

  /** @param {{all: typeof durableCore.all}} reader @returns {Record<string, import("node:sqlite").SQLInputValue>[]} */
  function activeRows(reader) {
    const rows = reader.all(
      `SELECT id, repository_url, verifier, created_at, expires_at
       FROM onboarding_tokens
       WHERE expires_at > ?
       ORDER BY created_at DESC, id DESC`,
      now(),
    );
    if (rows.some((row) => !row)) {
      throw new TypeError("Onboarding token row is unavailable");
    }
    return /** @type {Record<string, import("node:sqlite").SQLInputValue>[]} */ (
      rows
    );
  }

  /** @param {{run: typeof durableCore.run}} writer */
  function purgeExpired(writer) {
    writer.run("DELETE FROM onboarding_tokens WHERE expires_at <= ?", now());
  }

  return {
    /** @param {unknown} request */
    create(request) {
      if (
        !request ||
        Array.isArray(request) ||
        typeof request !== "object" ||
        Object.keys(request).length !== 1 ||
        typeof (
          /** @type {{repository_url?: unknown}} */ (request).repository_url
        ) !== "string"
      ) {
        fail(
          "onboarding_token_request_malformed",
          "Onboarding token request must contain one Repository URL",
        );
      }
      const repositoryUrl = normalizePublicRepositoryUrl({
        url: /** @type {{repository_url: string}} */ (request).repository_url,
      });
      /** @type {ReturnType<typeof publicToken> & {token: string} | undefined} */
      let result;
      durableCore.transaction((transaction) => {
        purgeExpired(transaction);
        if (
          transaction.get(
            "SELECT 1 FROM onboarding_tokens WHERE repository_url = ?",
            repositoryUrl,
          )
        ) {
          fail(
            "onboarding_token_already_active",
            "An onboarding token is already active for this Repository",
          );
        }
        const token = createToken(randomBytes);
        const createdAt = now();
        const row = {
          id: createId(),
          repository_url: repositoryUrl,
          created_at: createdAt,
          expires_at: createdAt + TOKEN_LIFETIME_MILLISECONDS,
        };
        transaction.run(
          `INSERT INTO onboarding_tokens
            (id, repository_url, verifier, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          row.id,
          row.repository_url,
          verifier(token).toString("base64"),
          row.created_at,
          row.expires_at,
        );
        recordAttribution(transaction, {
          action: "onboarding_token_create",
          channel: "browser_session",
          occurredAt: createdAt,
          outcome: "success",
        });
        registerSecret(token);
        result = { ...row, token };
      });
      return /** @type {NonNullable<typeof result>} */ (result);
    },
    list() {
      return durableCore.transaction((transaction) => {
        purgeExpired(transaction);
        return activeRows(transaction).map(publicToken);
      });
    },
    /** @param {unknown} token */
    authenticate(token) {
      const row = activeRows(durableCore).find((candidate) =>
        matches(token, candidate.verifier),
      );
      return row ? publicToken(row) : null;
    },
    /** @param {string} id */
    revoke(id) {
      durableCore.transaction((transaction) => {
        purgeExpired(transaction);
        const result = transaction.run(
          "DELETE FROM onboarding_tokens WHERE id = ?",
          id,
        );
        if (result.changes !== 1) {
          fail("onboarding_token_not_active", "Onboarding token is not active");
        }
        recordAttribution(transaction, {
          action: "onboarding_token_revoke",
          channel: "browser_session",
          occurredAt: now(),
          outcome: "success",
        });
      });
    },
    /** @param {unknown} token */
    selfRevoke(token) {
      durableCore.transaction((transaction) => {
        const row = activeRows(transaction).find((candidate) =>
          matches(token, candidate.verifier),
        );
        if (!row) {
          fail("onboarding_token_not_active", "Onboarding token is not active");
        }
        transaction.run("DELETE FROM onboarding_tokens WHERE id = ?", row.id);
        recordAttribution(transaction, {
          action: "onboarding_token_revoke",
          channel: "onboarding_token",
          occurredAt: now(),
          outcome: "success",
        });
      });
    },
  };
}
