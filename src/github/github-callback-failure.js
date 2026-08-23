const FAILURE_LIFETIME_MS = 60 * 60 * 1_000;

/**
 * @param {{
 *   now: () => number,
 *   randomBytes: (size: number) => Buffer
 * }} dependencies
 */
export function createGitHubCallbackFailureStore({ now, randomBytes }) {
  /** @type {Map<string, {code: string, createdAt: number, message: string}>} */
  const failures = new Map();
  return {
    /** @param {Error & {code: string}} error */
    record(error) {
      if (
        !(error instanceof Error) ||
        typeof error.code !== "string" ||
        error.code.length === 0 ||
        error.message.length === 0
      ) {
        throw new TypeError("callback failure must be a coded Error");
      }
      const receipt = randomBytes(32).toString("base64url");
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(receipt)) {
        throw new TypeError("randomBytes must return usable entropy");
      }
      failures.set(receipt, {
        code: error.code,
        createdAt: now(),
        message: error.message,
      });
      return receipt;
    },
    /** @param {string} receipt */
    consume(receipt) {
      if (
        typeof receipt !== "string" ||
        !/^[A-Za-z0-9_-]{8,256}$/.test(receipt)
      ) {
        return null;
      }
      const failure = failures.get(receipt);
      failures.delete(receipt);
      if (!failure || now() - failure.createdAt > FAILURE_LIFETIME_MS) {
        return null;
      }
      return { code: failure.code, message: failure.message };
    },
    destroy() {
      failures.clear();
    },
  };
}
