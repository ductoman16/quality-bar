import { readCodexCapability } from "./application-runtime.ts";

export function createApplicationInterface(context: {
  close: () => Promise<unknown>;
  deps: Record<string, any>;
  durableCore: any;
  getCodexCapabilityFailure: () => any;
  requireStorageReserve: () => any;
  server: import("fastify").FastifyInstance;
  storageBoundary: any;
  workerSignal: any;
}) {
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
    admitWork(admit: () => unknown) {
      if (typeof admit !== "function") {
        throw new TypeError("work admission transition is required");
      }
      requireStorageReserve().assertWorkAdmissionAvailable();
      return admit();
    },
    startCodexProcess(start: () => import("node:child_process").ChildProcess) {
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
