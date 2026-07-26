const FAILED_LOGIN_ATTEMPTS_METADATA_KEY = "failed_operator_login_attempts";
const FAILED_LOGIN_UNTIL_METADATA_KEY = "failed_operator_login_until";
const FIRST_FAILED_LOGIN_DELAY_MS = 1_000;
const MAX_FAILED_LOGIN_DELAY_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 7;

export class OperatorLoginThrottleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "OperatorLoginThrottleError";
    this.code = code;
    /** @type {number | null} */
    this.retryAfterSeconds = null;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new OperatorLoginThrottleError(code, message);
}

/**
 * @typedef {{
 *   get: (
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ) => Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   run: (
 *     sql: string,
 *     ...parameters: import("node:sqlite").SQLInputValue[]
 *   ) => unknown
 * }} ThrottleStore
 */
/**
 * @param {ThrottleStore} store
 * @param {string} key
 */
function readNonnegativeInteger(store, key) {
  const row = /** @type {{ value: string } | undefined} */ (
    store.get("SELECT value FROM quality_bar_metadata WHERE key = ?", key)
  );
  const value = row?.value;
  if (value === undefined) {
    return 0;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("login_throttle_unavailable", "Login throttling is unavailable");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    fail("login_throttle_unavailable", "Login throttling is unavailable");
  }
  return number;
}

/** @param {ThrottleStore} store */
function readState(store) {
  const attempts = readNonnegativeInteger(
    store,
    FAILED_LOGIN_ATTEMPTS_METADATA_KEY,
  );
  const until = readNonnegativeInteger(store, FAILED_LOGIN_UNTIL_METADATA_KEY);
  if (attempts > MAX_FAILED_LOGIN_ATTEMPTS) {
    fail("login_throttle_unavailable", "Login throttling is unavailable");
  }
  return { attempts, until };
}

/**
 * @param {ThrottleStore} store
 * @param {string} key
 * @param {number} value
 */
function writeMetadata(store, key, value) {
  store.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    String(value),
  );
}

/** @param {number} now */
function nowMilliseconds(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError(
      "now must be a nonnegative integer millisecond timestamp",
    );
  }
  return now;
}

/** @param {number} attempts */
function delayMilliseconds(attempts) {
  return Math.min(
    FIRST_FAILED_LOGIN_DELAY_MS * 2 ** (attempts - 1),
    MAX_FAILED_LOGIN_DELAY_MS,
  );
}

/**
 * @param {ThrottleStore} durableCore
 * @param {number} now
 */
export function rejectDuringFailedLoginDelay(durableCore, now) {
  const timestamp = nowMilliseconds(now);
  const { until } = readState(durableCore);
  if (until > timestamp) {
    const error = new OperatorLoginThrottleError(
      "login_throttled",
      "Login is temporarily throttled",
    );
    error.retryAfterSeconds = Math.ceil((until - timestamp) / 1_000);
    throw error;
  }
}

/**
 * @param {ReturnType<typeof import("./durable-core.js").openDurableCore>} durableCore
 * @param {number} now
 */
export function recordFailedOperatorLogin(durableCore, now) {
  const timestamp = nowMilliseconds(now);
  return durableCore.transaction((transaction) => {
    const { attempts } = readState(transaction);
    const nextAttempts = Math.min(attempts + 1, MAX_FAILED_LOGIN_ATTEMPTS);
    const delayMs = delayMilliseconds(nextAttempts);
    writeMetadata(
      transaction,
      FAILED_LOGIN_ATTEMPTS_METADATA_KEY,
      nextAttempts,
    );
    writeMetadata(
      transaction,
      FAILED_LOGIN_UNTIL_METADATA_KEY,
      timestamp + delayMs,
    );
    return { retryAfterSeconds: Math.ceil(delayMs / 1_000) };
  });
}

/** @param {ThrottleStore} store */
export function clearFailedOperatorLoginDelay(store) {
  store.run(
    "DELETE FROM quality_bar_metadata WHERE key IN (?, ?)",
    FAILED_LOGIN_ATTEMPTS_METADATA_KEY,
    FAILED_LOGIN_UNTIL_METADATA_KEY,
  );
}
