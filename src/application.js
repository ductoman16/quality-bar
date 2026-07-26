import { openDurableCore } from "./durable-core.js";
import {
  loadInstallationConfiguration,
  verifyInstallationKey,
} from "./installation-configuration.js";
import {
  validateBundledTools,
  validateCodexLogin,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "./installation-environment.js";
import {
  createBrowserSessionService,
  createUnavailableBrowserSessionService,
} from "./browser-session.js";
import {
  createImplementerTokenService,
  createUnavailableImplementerTokenService,
} from "./implementer-token.js";
import { createApplicationServer } from "./server.js";
import {
  createRequestSecurityBoundary,
  createUnavailableRequestSecurityBoundary,
} from "./request-security.js";
import {
  createReviewService,
  createUnavailableReviewService,
} from "./review.js";
import { createSystemResource } from "./system-resource.js";

const CODEX_TERMINATION_GRACE_MS = 5_000;

function structuredLog(writeLog, severity, event, component, outcome, error) {
  const record = {
    timestamp: new Date().toISOString(),
    severity,
    event,
    component,
    outcome,
  };
  if (error) {
    record.error = error.code;
    record.detail = error.message;
  }
  writeLog(`${JSON.stringify(record)}\n`);
}

function createHardStorageBoundary(writeLog) {
  const workers = new AbortController();
  const codexProcesses = new Set();
  let failure = null;

  function terminateCodexProcess(process) {
    if (process.exitCode !== null || process.signalCode !== null) {
      return;
    }
    process.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (process.exitCode === null && process.signalCode === null) {
        process.kill("SIGKILL");
      }
    }, CODEX_TERMINATION_GRACE_MS);
    forceKill.unref();
    process.once("exit", () => clearTimeout(forceKill));
  }

  return {
    signal: workers.signal,
    get failure() {
      return failure;
    },
    enter(error) {
      if (failure) {
        return;
      }
      failure = error;
      workers.abort(error);
      for (const process of codexProcesses) {
        terminateCodexProcess(process);
      }
      structuredLog(
        writeLog,
        "error",
        "storage_unavailable",
        "storage",
        "failure",
        error,
      );
    },
    registerCodexProcess(process) {
      if (
        typeof process?.kill !== "function" ||
        typeof process?.once !== "function"
      ) {
        throw new TypeError("a running child process is required");
      }
      if (failure) {
        terminateCodexProcess(process);
        return;
      }
      codexProcesses.add(process);
      process.once("exit", () => codexProcesses.delete(process));
    },
  };
}

export function createApplication({
  databasePath,
  loadInstallation = loadInstallationConfiguration,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
  validateTools = validateBundledTools,
  validateCodexAuthentication = validateCodexLogin,
  createReviews = createReviewService,
  now = () => Date.now(),
  writeLog = (line) => process.stderr.write(line),
}) {
  if (typeof databasePath !== "string" || databasePath.length === 0) {
    throw new TypeError("databasePath is required");
  }

  const storageBoundary = createHardStorageBoundary(writeLog);
  let durableCore = null;
  let browserSessions = null;
  let implementerTokens = null;
  let browserOrigin = null;
  let requestSecurity = null;
  let reviews = null;
  let systemResource = null;
  let secureBrowserCookie = false;
  let codexCapabilityFailure = null;
  let releaseInstallationLock = null;
  let startupFailure = null;

  try {
    validateSources();
    const installation = loadInstallation();
    browserOrigin = installation.externalOrigin;
    requestSecurity = createRequestSecurityBoundary(installation);
    secureBrowserCookie = installation.externalOrigin.startsWith("https:");
    ({ releaseInstallationLock } = validateInstallation());
    durableCore = openDurableCore(databasePath, {
      onStorageUnavailable(error) {
        storageBoundary.enter(error);
      },
    });
    verifyInstallationKey(durableCore, installation.masterKey);
    installation.masterKey.fill(0);
    browserSessions = createBrowserSessionService(durableCore, { now });
    implementerTokens = createImplementerTokenService(durableCore, { now });
    reviews = createReviews(durableCore, { now });
    systemResource = createSystemResource(durableCore, { now });
    validateTools();
    try {
      validateCodexAuthentication();
    } catch (error) {
      codexCapabilityFailure = error;
      structuredLog(
        writeLog,
        "error",
        "codex_capability_unavailable",
        "codex",
        "failure",
        error,
      );
    }
    structuredLog(
      writeLog,
      "info",
      "installation_ready",
      "configuration",
      "success",
    );
  } catch (error) {
    durableCore?.close();
    durableCore = null;
    releaseInstallationLock?.();
    releaseInstallationLock = null;
    startupFailure = error;
    requestSecurity = createUnavailableRequestSecurityBoundary(startupFailure);
    browserSessions = createUnavailableBrowserSessionService(startupFailure);
    implementerTokens =
      createUnavailableImplementerTokenService(startupFailure);
    reviews = createUnavailableReviewService(startupFailure);
    structuredLog(
      writeLog,
      "error",
      "installation_not_ready",
      "configuration",
      "failure",
      error,
    );
  }

  function readDurableCoreStatus() {
    const error = storageBoundary.failure ?? startupFailure;
    return error
      ? { error: error.code, status: "not_ready" }
      : { status: "ready" };
  }

  const server = createApplicationServer({
    browserSessions,
    implementerTokens,
    browserOrigin,
    requestSecurity,
    reviews,
    readDurableCoreStatus,
    readSystemStatus: () => ({
      ...systemResource.readFacts({
        browserSessions,
        codex: codexCapabilityFailure
          ? { error: codexCapabilityFailure.code, status: "unavailable" }
          : { status: "available" },
        implementerToken: implementerTokens?.hasActiveToken()
          ? { status: "active" }
          : { status: "revoked" },
      }),
    }),
    listAuthorityAttributions: (query) =>
      systemResource.listAuthorityAttributions(query),
    recordAuthorityAttribution: (event) =>
      systemResource.recordAuthorityAttribution(event),
    secureBrowserCookie,
  });

  return {
    server,
    durableCore,
    implementerTokens,
    get codexCapability() {
      return codexCapabilityFailure
        ? { error: codexCapabilityFailure.code, status: "unavailable" }
        : { status: "available" };
    },
    workerSignal: storageBoundary.signal,
    registerCodexProcess(process) {
      storageBoundary.registerCodexProcess(process);
    },
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      durableCore?.close();
      releaseInstallationLock?.();
      releaseInstallationLock = null;
    },
  };
}
