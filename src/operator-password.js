import { randomBytes as createRandomBytes, scryptSync } from "node:crypto";

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
  });
}
