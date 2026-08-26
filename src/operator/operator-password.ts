import {
  randomBytes as createRandomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { insertAuthorityAttribution } from "../authority-attribution.ts";
import { clearFailedOperatorLoginDelay } from "./operator-login-throttle.ts";

export const OPERATOR_PASSWORD_VERIFIER_METADATA_KEY =
  "operator_password_verifier";

const MINIMUM_PASSWORD_LENGTH = 15;
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_DERIVED_KEY_BYTES = 32;

export class OperatorPasswordError extends Error {
  name: "OperatorPasswordError";
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OperatorPasswordError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new OperatorPasswordError(code, message, { cause });
}

function passwordCharacterCount(password: string) {
  return Array.from(password).length;
}

function validatedNewOperatorPassword(password: unknown) {
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

function createPasswordVerifier(
  password: string,
  randomBytes: (size: number) => Buffer,
) {
  let salt: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let derivedKey: Buffer<ArrayBufferLike> = Buffer.alloc(0);
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

function readPasswordVerifier(value: unknown) {
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

export function verifyOperatorPassword(
  durableCore: {
    get: (
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
  },
  password: unknown,
) {
  if (typeof password !== "string") {
    fail("authentication_invalid", "Operator password is invalid");
  }
  const row = durableCore.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    OPERATOR_PASSWORD_VERIFIER_METADATA_KEY,
  ) as { value: string } | undefined;
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

export function prepareOperatorPasswordReplacement(
  durableCore: {
    get: (
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
  },
  currentPassword: unknown,
  replacementPassword: unknown,
  {
    randomBytes = createRandomBytes,
  }: { randomBytes?: (size: number) => Buffer } = {},
) {
  verifyOperatorPassword(durableCore, currentPassword);
  return createPasswordVerifier(
    validatedNewOperatorPassword(replacementPassword),
    randomBytes,
  );
}

export function bootstrapOperatorPassword(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  password: unknown,
  {
    randomBytes = createRandomBytes,
  }: { randomBytes?: (size: number) => Buffer } = {},
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

function replaceOperatorAuthority(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  password: unknown,
  {
    requireExisting,
    now = () => Date.now(),
    randomBytes = createRandomBytes,
    recordAttribution = insertAuthorityAttribution,
  }: {
    requireExisting: boolean;
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    recordAttribution?: typeof insertAuthorityAttribution;
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

export function recoverOperatorAuthority(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  password: unknown,
  options: {
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    recordAttribution?: typeof insertAuthorityAttribution;
  } = {},
) {
  replaceOperatorAuthority(durableCore, password, {
    ...options,
    requireExisting: true,
  });
}

export function replaceRestoredOperatorAuthority(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  password: unknown,
  options: {
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
    recordAttribution?: typeof insertAuthorityAttribution;
  } = {},
) {
  replaceOperatorAuthority(durableCore, password, {
    ...options,
    requireExisting: false,
  });
}
