import { readCodexCapability } from "./application-runtime.js";

/**
 * @param {{
 *   close: () => Promise<unknown>,
 *   deps: Record<string, any>,
 *   durableCore: any,
 *   getCodexCapabilityFailure: () => any,
 *   requireStorageReserve: () => any,
 *   server: import("fastify").FastifyInstance,
 *   storageBoundary: any,
 *   workerSignal: any,
 * }} context
 */
export function createApplicationInterface(context) {
  const {
    close,
    deps,
    durableCore,
    getCodexCapabilityFailure,
    requireStorageReserve,
    server,
    storageBoundary,
    workerSignal,
  } = context;
  return {
    server,
    durableCore,
    implementerTokens: deps.implementerTokens,
    onboardingTokens: deps.onboardingTokens,
    get codexCapability() {
      return readCodexCapability(getCodexCapabilityFailure());
    },
    workerSignal,
    /** @param {() => unknown} admit */
    admitWork(admit) {
      if (typeof admit !== "function") {
        throw new TypeError("work admission transition is required");
      }
      requireStorageReserve().assertWorkAdmissionAvailable();
      return admit();
    },
    /** @param {() => import("node:child_process").ChildProcess} start */
    startCodexProcess(start) {
      if (typeof start !== "function") {
        throw new TypeError("Codex start transition is required");
      }
      requireStorageReserve().assertCodexStartAvailable();
      const childProcess = start();
      storageBoundary.registerCodexProcess(childProcess);
      return childProcess;
    },
    cleanupEligibleData: () => requireStorageReserve().cleanupEligibleData(),
    freezeWaiverAdjudicatorConfiguration() {
      return deps.waiverAdjudicatorConfiguration.freezeForAdjudication();
    },
    close,
  };
}
