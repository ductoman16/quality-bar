import {
  randomBytes as createRandomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { insertAuthorityAttribution } from "./authority-attribution.js";
import { clearFailedOperatorLoginDelay } from "./operator-login-throttle.js";

export const OPERATOR_PASSWORD_VERIFIER_METADATA_KEY =
  "operator_password_verifier";

const MINIMUM_PASSWORD_LENGTH = 15;
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_DERIVED_KEY_BYTES = 32;

export class OperatorPasswordError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "OperatorPasswordError";
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
  throw new OperatorPasswordError(code, message, { cause });
}

/** @param {string} password */
function passwordCharacterCount(password) {
  return Array.from(password).length;
}

/** @param {unknown} password */
function validatedNewOperatorPassword(password) {
  if (typeof password !== "string") {
    fail(
      "operator_password_input_missing",
      "Operator password input is required",
    );
  }
  if (passwordCharacterCount(password) < MINIMUM_PASSWORD_LENGTH) {
    fail(
      "operator_password_too_short",
      "Operator password must be at least 15 characters",
    );
  }
  return password;
}

/**
 * @param {string} password
 * @param {(size: number) => Buffer} randomBytes
 */
function createPasswordVerifier(password, randomBytes) {
  /** @type {Buffer<ArrayBufferLike>} */
  let salt = Buffer.alloc(0);
  /** @type {Buffer<ArrayBufferLike>} */
  let derivedKey = Buffer.alloc(0);
  try {
    salt = randomBytes(SCRYPT_SALT_BYTES);
    derivedKey = scryptSync(password, salt, SCRYPT_DERIVED_KEY_BYTES, {
      N: SCRYPT_COST,
      maxmem: 64 * 1024 * 1024,
      p: SCRYPT_PARALLELIZATION,
      r: SCRYPT_BLOCK_SIZE,
    });
  } catch (error) {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be created",
      error,
    );
  }

  if (!Buffer.isBuffer(salt) || salt.length !== SCRYPT_SALT_BYTES) {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be created",
    );
  }
  return [
    "scrypt-v1",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join(".");
}

/** @param {unknown} value */
function readPasswordVerifier(value) {
  if (typeof value !== "string") {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be read",
    );
  }
  const [
    version,
    cost,
    blockSize,
    parallelization,
    salt,
    derivedKey,
    ...extra
  ] = value.split(".");
  if (
    version !== "scrypt-v1" ||
    extra.length !== 0 ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    typeof salt !== "string" ||
    typeof derivedKey !== "string" ||
    !/^[A-Za-z0-9+/]{22}==$/.test(salt) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(derivedKey)
  ) {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be read",
    );
  }
  const saltBytes = Buffer.from(salt, "base64");
  const derivedKeyBytes = Buffer.from(derivedKey, "base64");
  if (
    saltBytes.length !== SCRYPT_SALT_BYTES ||
    derivedKeyBytes.length !== SCRYPT_DERIVED_KEY_BYTES
  ) {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be read",
    );
  }
  return { derivedKey: derivedKeyBytes, salt: saltBytes };
}

/**
 * @param {{
 *   get: (
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ) => Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 * @param {unknown} password
 */
export function verifyOperatorPassword(durableCore, password) {
  if (typeof password !== "string") {
    fail("authentication_invalid", "Operator password is invalid");
  }
  const row = /** @type {{ value: string } | undefined} */ (
    durableCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    )
  );
  const storedVerifier = row?.value;
  if (storedVerifier === undefined) {
    fail(
      "operator_password_uninitialized",
      "Operator password has not been bootstrapped",
    );
  }
  const verifier = readPasswordVerifier(storedVerifier);
  let candidate = Buffer.alloc(0);
  try {
    candidate = scryptSync(password, verifier.salt, SCRYPT_DERIVED_KEY_BYTES, {
      N: SCRYPT_COST,
      maxmem: 64 * 1024 * 1024,
      p: SCRYPT_PARALLELIZATION,
      r: SCRYPT_BLOCK_SIZE,
    });
  } catch (error) {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be read",
      error,
    );
  }
  if (!timingSafeEqual(candidate, verifier.derivedKey)) {
    fail("authentication_invalid", "Operator password is invalid");
  }
}

/**
 * @param {{
 *   get: (
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ) => Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 * @param {unknown} currentPassword
 * @param {unknown} replacementPassword
 * @param {{ randomBytes?: (size: number) => Buffer }} [options]
 */
export function prepareOperatorPasswordReplacement(
  durableCore,
  currentPassword,
  replacementPassword,
  { randomBytes = createRandomBytes } = {},
) {
  verifyOperatorPassword(durableCore, currentPassword);
  return createPasswordVerifier(
    validatedNewOperatorPassword(replacementPassword),
    randomBytes,
  );
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {unknown} password
 * @param {{ randomBytes?: (size: number) => Buffer }} [options]
 */
export function bootstrapOperatorPassword(
  durableCore,
  password,
  { randomBytes = createRandomBytes } = {},
) {
  const validatedPassword = validatedNewOperatorPassword(password);

  durableCore.transaction((transaction) => {
    const existingVerifier = transaction.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    );
    if (existingVerifier) {
      fail("operator_password_already_set", "Operator password is already set");
    }
    transaction.run(
      "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
      createPasswordVerifier(validatedPassword, randomBytes),
    );
    clearFailedOperatorLoginDelay(transaction);
  });
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {unknown} password
 * @param {{
 *   requireExisting: boolean,
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   recordAttribution?: typeof insertAuthorityAttribution,
 * }} options
 */
function replaceOperatorAuthority(
  durableCore,
  password,
  {
    requireExisting,
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    recordAttribution = insertAuthorityAttribution,
  },
) {
  const validatedPassword = validatedNewOperatorPassword(password);
  const occurredAt = now();

  durableCore.transaction((transaction) => {
    const existingVerifier = transaction.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
    );
    if (requireExisting && !existingVerifier) {
      fail(
        "operator_password_uninitialized",
        "Operator password has not been bootstrapped",
      );
    }
    transaction.run(
      `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
      createPasswordVerifier(validatedPassword, randomBytes),
    );
    transaction.run("DELETE FROM browser_sessions");
    transaction.run(
      "DELETE FROM quality_bar_metadata WHERE key = ?",
      "implementer_token_verifier",
    );
    clearFailedOperatorLoginDelay(transaction);
    recordAttribution(transaction, {
      action: "password_recovery",
      channel: "host",
      occurredAt,
      outcome: "success",
    });
  });
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {unknown} password
 * @param {{
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   recordAttribution?: typeof insertAuthorityAttribution,
 * }} [options]
 */
export function recoverOperatorAuthority(durableCore, password, options = {}) {
  replaceOperatorAuthority(durableCore, password, {
    ...options,
    requireExisting: true,
  });
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {unknown} password
 * @param {{
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 *   recordAttribution?: typeof insertAuthorityAttribution,
 * }} [options]
 */
export function replaceRestoredOperatorAuthority(
  durableCore,
  password,
  options = {},
) {
  replaceOperatorAuthority(durableCore, password, {
    ...options,
    requireExisting: false,
  });
}
