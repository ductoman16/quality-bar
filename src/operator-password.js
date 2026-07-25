import {
  randomBytes as createRandomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

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
  constructor(code, message, options) {
    super(message, options);
    this.name = "OperatorPasswordError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new OperatorPasswordError(code, message, { cause });
}

function passwordCharacterCount(password) {
  return Array.from(password).length;
}

function createPasswordVerifier(password, randomBytes) {
  let salt;
  let derivedKey;
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

function readPasswordVerifier(value) {
  if (typeof value !== "string") {
    fail(
      "operator_password_verifier_unavailable",
      "Operator password verifier could not be read",
    );
  }
  const [version, cost, blockSize, parallelization, salt, derivedKey, ...extra] =
    value.split(".");
  if (
    version !== "scrypt-v1" ||
    extra.length !== 0 ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
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

export function verifyOperatorPassword(durableCore, password) {
  if (typeof password !== "string") {
    fail("authentication_invalid", "Operator password is invalid");
  }
  const storedVerifier = durableCore.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  )?.value;
  if (storedVerifier === undefined) {
    fail(
      "operator_password_uninitialized",
      "Operator password has not been bootstrapped",
    );
  }
  const verifier = readPasswordVerifier(storedVerifier);
  let candidate;
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

export function prepareOperatorPasswordReplacement(
  durableCore,
  currentPassword,
  replacementPassword,
  { randomBytes = createRandomBytes } = {},
) {
  verifyOperatorPassword(durableCore, currentPassword);
  if (typeof replacementPassword !== "string") {
    fail("operator_password_input_missing", "Operator password input is required");
  }
  if (passwordCharacterCount(replacementPassword) < MINIMUM_PASSWORD_LENGTH) {
    fail(
      "operator_password_too_short",
      "Operator password must be at least 15 characters",
    );
  }
  return createPasswordVerifier(replacementPassword, randomBytes);
}

export function bootstrapOperatorPassword(
  durableCore,
  password,
  { randomBytes = createRandomBytes } = {},
) {
  if (typeof password !== "string") {
    fail("operator_password_input_missing", "Operator password input is required");
  }
  if (passwordCharacterCount(password) < MINIMUM_PASSWORD_LENGTH) {
    fail(
      "operator_password_too_short",
      "Operator password must be at least 15 characters",
    );
  }

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
      createPasswordVerifier(password, randomBytes),
    );
    clearFailedOperatorLoginDelay(transaction);
  });
}
