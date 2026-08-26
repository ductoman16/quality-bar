const FAILURE_LIFETIME_MS = 60 * 60 * 1_000;

export function createGitHubCallbackFailureStore({
  now,
  randomBytes,
}: {
  now: () => number;
  randomBytes: (size: number) => Buffer;
}) {
  const failures: Map<
    string,
    { code: string; createdAt: number; message: string }
  > = new Map();
  return {
    record(error: Error & { code: string }) {
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
    consume(receipt: string) {
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
