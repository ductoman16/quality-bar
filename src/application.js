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
import { readBrowserAsset as readMaintainedBrowserAsset } from "./browser-assets.js";
import { requireCodedError } from "./coded-error.js";
import {
  createImplementerTokenService,
  createUnavailableImplementerTokenService,
} from "./implementer-token.js";
import {
  createGitHubConnectionService,
  createUnavailableGitHubConnectionService,
} from "./github-connection.js";
import { GitHubConnectionError } from "./github-connection-error.js";
import {
  createForgejoConnectionService,
  unavailableForgejoConnectionService,
} from "./forgejo-connection.js";
import { createApplicationServer } from "./server.js";
import {
  createRequestSecurityBoundary,
  createUnavailableRequestSecurityBoundary,
} from "./request-security.js";
import {
  createReviewService,
  createUnavailableReviewService,
} from "./review.js";
import {
  createRepositoryService,
  createUnavailableRepositoryService,
} from "./repository.js";
import { fail as failRepository } from "./repository-validation.js";
import {
  createRepositoryGuidanceService,
  createUnavailableRepositoryGuidanceService,
} from "./repository-guidance.js";
import { createSystemResource } from "./system-resource.js";
import {
  createUnavailableWaiverAdjudicatorConfigurationService,
  createWaiverAdjudicatorConfigurationService,
} from "./waiver-adjudicator-configuration.js";

const CODEX_TERMINATION_GRACE_MS = 5_000;
const REPOSITORY_SCOPED_GITHUB_ERRORS = new Set([
  "github_private_git_read_failed",
  "github_repository_api_access_failed",
  "github_repository_git_read_failed",
  "github_repository_selection_unavailable",
]);

/**
 * @typedef {ReturnType<typeof requireCodedError>} CodedError
 */
/**
 * @param {(line: string) => unknown} writeLog
 * @param {string} severity
 * @param {string} event
 * @param {string} component
 * @param {string} outcome
 * @param {CodedError} [error]
 */
function structuredLog(writeLog, severity, event, component, outcome, error) {
  const record = /** @type {{
   *   component: string,
   *   detail?: string,
   *   error?: string,
   *   event: string,
   *   outcome: string,
   *   severity: string,
   *   timestamp: string
   * }} */ ({
    timestamp: new Date().toISOString(),
    severity,
    event,
    component,
    outcome,
  });
  if (error) {
    record.error = error.code;
    record.detail = error.message;
  }
  writeLog(`${JSON.stringify(record)}\n`);
}

/** @param {(line: string) => unknown} writeLog */
function createHardStorageBoundary(writeLog) {
  const workers = new AbortController();
  const codexProcesses = new Set(
    /** @type {import("node:child_process").ChildProcess[]} */ ([]),
  );
  /** @type {CodedError | null} */
  let failure = null;

  /** @param {import("node:child_process").ChildProcess} childProcess */
  function terminateCodexProcess(childProcess) {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return;
    }
    childProcess.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill("SIGKILL");
      }
    }, CODEX_TERMINATION_GRACE_MS);
    forceKill.unref();
    childProcess.once("exit", () => clearTimeout(forceKill));
  }

  return {
    signal: workers.signal,
    get failure() {
      return failure;
    },
    /** @param {CodedError} error */
    enter(error) {
      if (failure) {
        return;
      }
      failure = error;
      workers.abort(error);
      for (const childProcess of codexProcesses) {
        terminateCodexProcess(childProcess);
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
    /** @param {import("node:child_process").ChildProcess} childProcess */
    registerCodexProcess(childProcess) {
      if (
        typeof childProcess?.kill !== "function" ||
        typeof childProcess?.once !== "function"
      ) {
        throw new TypeError("a running child process is required");
      }
      if (failure) {
        terminateCodexProcess(childProcess);
        return;
      }
      codexProcesses.add(childProcess);
      childProcess.once("exit", () => codexProcesses.delete(childProcess));
    },
  };
}

/**
 * @param {{
 *   databasePath: string,
 *   loadInstallation?: typeof loadInstallationConfiguration,
 *   validateInstallation?: typeof validateInstallationFilesystem,
 *   validateSources?: typeof validateInstallationSources,
 *   validateTools?: typeof validateBundledTools,
 *   validateCodexAuthentication?: typeof validateCodexLogin,
 *   createReviews?: typeof createReviewService,
 *   createRepositories?: typeof createRepositoryService,
 *   createGitHubConnections?: (...arguments_: any[]) => any,
 *   createForgejoConnections?: (...arguments_: any[]) => any,
 *   createRepositoryGuidance?: typeof createRepositoryGuidanceService,
 *   createWaiverAdjudicatorConfiguration?: typeof createWaiverAdjudicatorConfigurationService,
 *   readBrowserAsset?: (path: string) => string,
 *   now?: () => number,
 *   writeLog?: (line: string) => unknown
 * }} options
 */
export function createApplication({
  databasePath,
  loadInstallation = loadInstallationConfiguration,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
  validateTools = validateBundledTools,
  validateCodexAuthentication = validateCodexLogin,
  createReviews = createReviewService,
  createRepositories = createRepositoryService,
  createGitHubConnections = createGitHubConnectionService,
  createForgejoConnections = createForgejoConnectionService,
  createRepositoryGuidance = createRepositoryGuidanceService,
  createWaiverAdjudicatorConfiguration = createWaiverAdjudicatorConfigurationService,
  readBrowserAsset = readMaintainedBrowserAsset,
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
  let browserOrigin = "";
  let requestSecurity = null;
  let reviews = null;
  let repositories = null;
  /** @type {any} */
  let githubConnections = null;
  /** @type {any} */
  let forgejoConnections = null;
  let repositoryGuidance = null;
  let waiverAdjudicatorConfiguration = null;
  let systemResource = null;
  let secureBrowserCookie = false;
  /** @type {CodedError | null} */
  let codexCapabilityFailure = null;
  /** @type {(() => void) | null} */
  let releaseInstallationLock = null;
  /** @type {CodedError | null} */
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
        storageBoundary.enter(requireCodedError(error));
      },
    });
    try {
      verifyInstallationKey(durableCore, installation.masterKey);
      githubConnections = createGitHubConnections(durableCore, {
        externalOrigin: installation.externalOrigin,
        masterKey: installation.masterKey,
        now,
      });
      forgejoConnections = createForgejoConnections(durableCore, {
        masterKey: installation.masterKey,
        now,
      });
      forgejoConnections.requireFreshBaseline();
      repositories = createRepositories(durableCore, {
        masterKey: installation.masterKey,
        now,
        async verifyForgeRepository(forgeRepositoryId, provider) {
          if (provider === "forgejo") {
            return forgejoConnections.prepareRepositoryEnablement(
              forgeRepositoryId,
            );
          }
          try {
            await githubConnections.selectRepositories(
              {
                repository_ids: [forgeRepositoryId],
              },
              "enablement",
            );
          } catch (error) {
            if (
              error instanceof GitHubConnectionError &&
              REPOSITORY_SCOPED_GITHUB_ERRORS.has(error.code)
            ) {
              failRepository(error.code, error.message, error);
            }
            if (error instanceof GitHubConnectionError) {
              throw new GitHubConnectionError(error.code, error.message, {
                cause: error,
              });
            }
            throw new TypeError("Forge Repository verification failed", {
              cause: error,
            });
          }
        },
      });
    } finally {
      installation.masterKey.fill(0);
    }
    browserSessions = createBrowserSessionService(durableCore, { now });
    implementerTokens = createImplementerTokenService(durableCore, { now });
    reviews = createReviews(durableCore, { now });
    repositoryGuidance = createRepositoryGuidance(durableCore);
    waiverAdjudicatorConfiguration = createWaiverAdjudicatorConfiguration(
      durableCore,
      { now },
    );
    systemResource = createSystemResource(durableCore, { now });
    validateTools();
    try {
      validateCodexAuthentication();
    } catch (error) {
      codexCapabilityFailure = requireCodedError(error);
      structuredLog(
        writeLog,
        "error",
        "codex_capability_unavailable",
        "codex",
        "failure",
        codexCapabilityFailure,
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
    repositories?.destroy?.();
    githubConnections?.destroy?.();
    forgejoConnections?.destroy?.();
    durableCore?.close();
    durableCore = null;
    releaseInstallationLock?.();
    releaseInstallationLock = null;
    startupFailure = requireCodedError(error);
    requestSecurity = createUnavailableRequestSecurityBoundary(startupFailure);
    browserSessions = createUnavailableBrowserSessionService(startupFailure);
    implementerTokens =
      createUnavailableImplementerTokenService(startupFailure);
    reviews = createUnavailableReviewService(startupFailure);
    repositories = createUnavailableRepositoryService(startupFailure);
    githubConnections =
      createUnavailableGitHubConnectionService(startupFailure);
    forgejoConnections = unavailableForgejoConnectionService(startupFailure);
    repositoryGuidance =
      createUnavailableRepositoryGuidanceService(startupFailure);
    waiverAdjudicatorConfiguration =
      createUnavailableWaiverAdjudicatorConfigurationService(startupFailure);
    structuredLog(
      writeLog,
      "error",
      "installation_not_ready",
      "configuration",
      "failure",
      startupFailure,
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
    browserAssetReader: readBrowserAsset,
    implementerTokens,
    browserOrigin,
    requestSecurity,
    repositories,
    githubConnections,
    forgejoConnections,
    repositoryGuidance,
    reviews,
    waiverAdjudicatorConfiguration,
    readDurableCoreStatus,
    readSystemStatus: () => {
      if (!systemResource) {
        throw startupFailure;
      }
      return {
        ...systemResource.readFacts({
          browserSessions,
          codex: codexCapabilityFailure
            ? { error: codexCapabilityFailure.code, status: "unavailable" }
            : { status: "available" },
          implementerToken: implementerTokens?.hasActiveToken()
            ? { status: "active" }
            : { status: "revoked" },
        }),
      };
    },
    listAuthorityAttributions: (query) => {
      if (!systemResource) {
        throw startupFailure;
      }
      return systemResource.listAuthorityAttributions(query);
    },
    recordAuthorityAttribution: (event) => {
      if (!systemResource) {
        throw startupFailure;
      }
      return systemResource.recordAuthorityAttribution(event);
    },
    recordMcpOperation: ({
      durationMs,
      errorCode,
      operation,
      outcome,
      requestId,
      resourceIds,
    }) => {
      writeLog(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          severity: outcome === "success" ? "info" : "error",
          event: "mcp_request",
          component: "mcp",
          outcome,
          request_id: requestId,
          operation,
          resource_ids: resourceIds,
          duration_ms: durationMs,
          ...(errorCode ? { error: errorCode } : {}),
        })}\n`,
      );
    },
    secureBrowserCookie,
  });
  githubConnections.startPolling();
  forgejoConnections.startPolling();

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
    /** @param {import("node:child_process").ChildProcess} childProcess */
    registerCodexProcess(childProcess) {
      storageBoundary.registerCodexProcess(childProcess);
    },
    freezeWaiverAdjudicatorConfiguration() {
      return waiverAdjudicatorConfiguration.freezeForAdjudication();
    },
    async close() {
      if (server.listening) {
        await /** @type {Promise<void>} */ (
          new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
        );
      }
      repositories?.destroy?.();
      githubConnections?.destroy?.();
      forgejoConnections?.destroy?.();
      durableCore?.close();
      releaseInstallationLock?.();
      releaseInstallationLock = null;
    },
  };
}
