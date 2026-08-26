const FAILED_LOGIN_ATTEMPTS_METADATA_KEY = "failed_operator_login_attempts";
const FAILED_LOGIN_UNTIL_METADATA_KEY = "failed_operator_login_until";
const FIRST_FAILED_LOGIN_DELAY_MS = 1_000;
const MAX_FAILED_LOGIN_DELAY_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 7;

export class OperatorLoginThrottleError extends Error {
  name: "OperatorLoginThrottleError";
  code: string;
  retryAfterSeconds: number | null;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OperatorLoginThrottleError";
    this.code = code;
    this.retryAfterSeconds = null as number | null;
  }
}

function fail(code: string, message: string): never {
  throw new OperatorLoginThrottleError(code, message);
}

export type ThrottleStore = {
  get: (
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ) => Record<string, import("node:sqlite").SQLInputValue> | undefined;
  run: (
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ) => unknown;
};
function readNonnegativeInteger(store: ThrottleStore, key: string) {
  const row = store.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    key,
  ) as { value: string } | undefined;
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

function readState(store: ThrottleStore) {
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

function writeMetadata(store: ThrottleStore, key: string, value: number) {
  store.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    String(value),
  );
}

function nowMilliseconds(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError(
      "now must be a nonnegative integer millisecond timestamp",
    );
  }
  return now;
}

function delayMilliseconds(attempts: number) {
  return Math.min(
    FIRST_FAILED_LOGIN_DELAY_MS * 2 ** (attempts - 1),
    MAX_FAILED_LOGIN_DELAY_MS,
  );
}

export function rejectDuringFailedLoginDelay(
  durableCore: ThrottleStore,
  now: number,
) {
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

export function recordFailedOperatorLogin(
  durableCore: ReturnType<
    typeof import("../durable/durable-core.ts").openDurableCore
  >,
  now: number,
) {
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

export function clearFailedOperatorLoginDelay(store: ThrottleStore) {
  store.run(
    "DELETE FROM quality_bar_metadata WHERE key IN (?, ?)",
    FAILED_LOGIN_ATTEMPTS_METADATA_KEY,
    FAILED_LOGIN_UNTIL_METADATA_KEY,
  );
}
