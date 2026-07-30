import { openDurableCore } from "./durable-core.js";
import { createCodexExecutionRuntime } from "./codex-execution-runtime.js";
import { createCodexExecutionConcurrencyService } from "./codex-execution-concurrency.js";
import { createApplicationExecutionRuntime } from "./application-execution-runtime.js";
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
import {
  createForgejoConnectionService,
  unavailableForgejoConnectionService,
} from "./forgejo-connection.js";
import { createApplicationRuntimeServer } from "./application-server-runtime.js";
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
import {
  prepareForgejoRepositoryEnablement,
  prepareGitHubRepositoryEnablement,
} from "./repository-provider-verification.js";
import {
  createRepositoryGuidanceService,
  createUnavailableRepositoryGuidanceService,
} from "./repository-guidance.js";
import { createSystemResource } from "./system-resource.js";
import {
  createUnavailableWaiverAdjudicatorConfigurationService,
  createWaiverAdjudicatorConfigurationService,
} from "./waiver-adjudicator-configuration.js";
import { createStorageReserveGate } from "./storage-reserve.js";
import {
  createHardStorageBoundary,
  structuredLog,
} from "./application-runtime.js";
import {
  createEvaluationService,
  createUnavailableEvaluationService,
} from "./evaluation.js";

/** @typedef {ReturnType<typeof requireCodedError>} CodedError */
/**
 * @param {{
 *   databasePath: string,
 *   loadInstallation?: typeof loadInstallationConfiguration,
 *   validateInstallation?: typeof validateInstallationFilesystem,
 *   validateSources?: typeof validateInstallationSources,
 *   validateTools?: typeof validateBundledTools,
 *   validateCodexAuthentication?: typeof validateCodexLogin,
 *   createReviews?: typeof createReviewService,
 *   createRepositories?: (...arguments_: any[]) => any,
 *   createGitHubConnections?: (...arguments_: any[]) => any,
 *   createForgejoConnections?: (...arguments_: any[]) => any,
 *   createRepositoryGuidance?: typeof createRepositoryGuidanceService,
 *   createWaiverAdjudicatorConfiguration?: typeof createWaiverAdjudicatorConfigurationService,
 *   createStorageReserve?: typeof createStorageReserveGate,
 *   createEvaluations?: typeof createEvaluationService,
 *   createCodexRuntime?: typeof createCodexExecutionRuntime,
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
  createStorageReserve = createStorageReserveGate,
  createEvaluations = createEvaluationService,
  createCodexRuntime = createCodexExecutionRuntime,
  readBrowserAsset = readMaintainedBrowserAsset,
  now = () => Date.now(),
  writeLog = (line) => process.stderr.write(line),
}) {
  if (typeof databasePath !== "string" || databasePath.length === 0) {
    throw new TypeError("databasePath is required");
  }

  /** @type {ReturnType<typeof openDurableCore> | null} */
  let durableCore = null;
  let browserSessions = null;
  let implementerTokens = null;
  let browserOrigin = "";
  let requestSecurity = null;
  let reviews = null;
  /** @type {ReturnType<typeof createRepositoryService> | null} */
  let repositories = null;
  /** @type {any} */
  let githubConnections = null;
  /** @type {any} */
  let forgejoConnections = null;
  let repositoryGuidance = null;
  let waiverAdjudicatorConfiguration = null;
  let systemResource = null;
  let storageReserve = null;
  /** @type {ReturnType<typeof createEvaluationService> | null} */
  let evaluations = null;
  /** @type {ReturnType<typeof createCodexExecutionRuntime> | null} */
  let codexRuntime = null;
  /** @type {ReturnType<typeof createCodexExecutionConcurrencyService> | null} */
  let codexExecutionConcurrency = null;
  /** @param {CodedError} [error] */
  function stopProductWork(error) {
    githubConnections?.destroy?.();
    forgejoConnections?.destroy?.();
    void codexRuntime?.close();
    if (error) {
      ioPool.shutdown(error);
    } else {
      void ioPool.close();
    }
  }
  const storageBoundary = createHardStorageBoundary(writeLog, stopProductWork);
  const executionRuntime = createApplicationExecutionRuntime({
    createCodexRuntime,
    now,
    stopIoDuties: stopProductWork,
    storageBoundary,
    writeLog,
  });
  const { ioPool } = executionRuntime;
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
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    storageReserve = ioPool.createStorageReserve(
      createStorageReserve,
      () => durableCore,
      now,
      installation.freeSpaceReserveBytes,
    );
    durableCore = openDurableCore(databasePath, {
      onStorageUnavailable(error) {
        storageBoundary.enter(requireCodedError(error));
      },
    });
    codexExecutionConcurrency =
      createCodexExecutionConcurrencyService(durableCore);
    try {
      verifyInstallationKey(durableCore, installation.masterKey);
      githubConnections = createGitHubConnections(durableCore, {
        acquirePullRequestChangeset: (
          /** @type {{pullRequest: any, repositoryId: string}} */ {
            pullRequest,
            repositoryId,
          },
        ) => {
          if (!repositories) {
            throw new TypeError("Repository service is unavailable");
          }
          return repositories.resolvePullRequestChangeset(repositoryId, {
            baseSha: pullRequest.base.sha,
            headSha: pullRequest.head.sha,
          });
        },
        admitAutomaticEvaluation: (
          /** @type {any} */ transaction,
          /** @type {any} */ input,
        ) => {
          if (!evaluations) {
            throw new TypeError("Evaluation service is unavailable");
          }
          return evaluations.admitAutomatic(transaction, input);
        },
        externalOrigin: installation.externalOrigin,
        masterKey: installation.masterKey,
        now,
        storageReserve,
      });
      forgejoConnections = createForgejoConnections(durableCore, {
        masterKey: installation.masterKey,
        now,
        storageReserve,
      });
      forgejoConnections.requireFreshBaseline();
      repositories = createRepositories(durableCore, {
        masterKey: installation.masterKey,
        now,
        resolveForgeCredential(
          /** @type {string} */ connectionId,
          /** @type {"github" | "forgejo"} */ provider,
        ) {
          const service =
            provider === "github" ? githubConnections : forgejoConnections;
          return service.acquireRepositoryGitCredential(connectionId);
        },
        async verifyForgeRepository(
          /** @type {number} */ forgeRepositoryId,
          /** @type {"github" | "forgejo"} */ provider,
        ) {
          if (provider === "forgejo") {
            return prepareForgejoRepositoryEnablement(
              forgejoConnections,
              forgeRepositoryId,
            );
          }
          return prepareGitHubRepositoryEnablement(
            githubConnections,
            forgeRepositoryId,
          );
        },
      });
      evaluations = createEvaluations(durableCore, {
        acquireChangeset: (repositoryId, request) =>
          ioPool.acquireChangeset(repositories, repositoryId, request),
        readCodexCapabilityFailure: () => codexCapabilityFailure,
        masterKey: installation.masterKey,
        now,
        storageReserve,
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
    if (!codexCapabilityFailure) {
      codexRuntime = executionRuntime.createCodexRuntime(
        durableCore,
        repositories,
        storageReserve,
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
    void codexRuntime?.close();
    codexRuntime = null;
    codexExecutionConcurrency = {
      read() {
        throw startupFailure;
      },
      set() {
        throw startupFailure;
      },
    };
    evaluations?.destroy?.();
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
    evaluations = createUnavailableEvaluationService(startupFailure);
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
    const error =
      storageBoundary.failure ?? executionRuntime.failure ?? startupFailure;
    return error
      ? { error: error.code, status: "not_ready" }
      : { status: "ready" };
  }

  const server = createApplicationRuntimeServer({
    browserSessions,
    browserAssetReader: readBrowserAsset,
    implementerTokens,
    browserOrigin,
    requestSecurity,
    repositories: /** @type {ReturnType<typeof createRepositoryService>} */ (
      repositories
    ),
    githubConnections,
    forgejoConnections,
    repositoryGuidance,
    evaluations,
    reviews,
    waiverAdjudicatorConfiguration,
    codexExecutionConcurrency,
    readDurableCoreStatus,
    codexCapabilityFailure,
    startupFailure,
    storageReserve,
    systemResource,
    workerSignal: storageBoundary.signal,
    writeLog,
    secureBrowserCookie,
  });
  githubConnections.startPolling();
  forgejoConnections.startPolling();
  codexRuntime?.start();

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
    /** @param {() => unknown} admit */
    admitWork(admit) {
      if (typeof admit !== "function") {
        throw new TypeError("work admission transition is required");
      }
      storageBoundary.assertAvailable();
      if (!storageReserve) {
        throw startupFailure;
      }
      storageReserve.assertWorkAdmissionAvailable();
      return admit();
    },
    /** @param {() => import("node:child_process").ChildProcess} start */
    startCodexProcess(start) {
      if (typeof start !== "function") {
        throw new TypeError("Codex start transition is required");
      }
      storageBoundary.assertAvailable();
      if (!storageReserve) {
        throw startupFailure;
      }
      storageReserve.assertCodexStartAvailable();
      const childProcess = start();
      storageBoundary.registerCodexProcess(childProcess);
      return childProcess;
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
      githubConnections?.destroy?.();
      forgejoConnections?.destroy?.();
      evaluations?.destroy?.();
      await codexRuntime?.close();
      codexRuntime = null;
      repositories?.destroy?.();
      await ioPool.close();
      durableCore?.close();
      releaseInstallationLock?.();
      releaseInstallationLock = null;
    },
  };
}
