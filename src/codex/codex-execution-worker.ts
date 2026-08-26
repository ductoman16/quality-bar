const CODEX_EXECUTION_CLAIM_INTERVAL_MS = 250;

export function createCodexExecutionWorker({
  claimService,
  executeClaim,
  reportFailure,
  clearTimer = (timer) => clearTimeout(timer as NodeJS.Timeout),
  setTimer = setTimeout,
}: {
  claimService: {
    claimNext: () =>
      | import("./codex-execution-claim.ts").CodexExecutionClaim
      | undefined;
  };
  executeClaim: (
    claim: import("./codex-execution-claim.ts").CodexExecutionClaim,
  ) => unknown;
  reportFailure: (
    error: unknown,
    claim?: import("./codex-execution-claim.ts").CodexExecutionClaim,
  ) => unknown;
  clearTimer?: (timer: unknown) => void;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
}) {
  if (
    typeof claimService?.claimNext !== "function" ||
    typeof executeClaim !== "function" ||
    typeof reportFailure !== "function" ||
    typeof clearTimer !== "function" ||
    typeof setTimer !== "function"
  ) {
    throw new TypeError("Codex execution worker dependencies are invalid");
  }
  let accepting = false;
  let timer: unknown | null = null;
  const active = new Set();

  function schedule(delay: number) {
    if (!accepting || timer !== null) {
      return;
    }
    timer = setTimer(runClaims, delay);
    (timer as any)?.unref?.();
  }

  function runClaims() {
    timer = null;
    if (!accepting) {
      return;
    }
    try {
      while (accepting) {
        const claim = claimService.claimNext();
        if (!claim) {
          break;
        }
        const execution = Promise.resolve().then(() => executeClaim(claim));
        active.add(execution);
        void execution
          .catch((error) => reportFailure(error, claim))
          .finally(() => {
            active.delete(execution);
            schedule(0);
          });
      }
    } catch (error) {
      reportFailure(error);
    }
    schedule(CODEX_EXECUTION_CLAIM_INTERVAL_MS);
  }

  return {
    async close() {
      accepting = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      await Promise.allSettled([...active]);
    },
    start() {
      if (accepting) {
        return;
      }
      accepting = true;
      schedule(0);
    },
  };
}
