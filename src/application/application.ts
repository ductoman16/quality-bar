import { openDurableCore } from "../durable/durable-core.ts";
import { createCodexExecutionRuntime } from "../codex/codex-execution-runtime.ts";
import { recoverCodexExecutions } from "../codex/codex-execution-recovery.ts";
import { createApplicationExecutionRuntime } from "./application-execution-runtime.ts";
import {
  loadInstallationConfiguration,
  verifyInstallationKey,
} from "../installation-configuration.ts";
import {
  BACKUPS_PATH,
  validateBundledTools,
  validateCodexLogin,
  validateInstallationFilesystem,
  validateInstallationSources,
} from "../installation-environment.ts";
import { createBrowserSessionService } from "../browser-session.ts";
import { requireCodedError } from "../coded-error.ts";
import { createImplementerTokenService } from "../implementer-token.ts";
import { createOnboardingTokenService } from "../onboarding-token.ts";
import { createApplicationRuntimeServer } from "./application-server-runtime.ts";
import { createRequestSecurityBoundary } from "../request-security.ts";
import { createStorageReserveGate } from "../storage-reserve.ts";
import {
  createWorkerSignal,
  createDurableCoreStatusReader,
  createHardStorageBoundary,
  readCodexCapability,
  requireAvailableStorageReserve,
  structuredLog,
} from "./application-runtime.ts";
import {
  createApplicationClose,
  createApplicationShutdownBoundary,
} from "./application-shutdown.ts";
import {
  createApplicationLog,
  createApplicationSecretRegistry,
} from "./application-log.ts";
import { installationKeyIdentity as computeInstallationKeyIdentity } from "../sqlite-backup.ts";
import { register as registerCodex } from "../codex/index.ts";
import { register as registerEvaluation } from "../evaluation/index.ts";
import { register as registerForgejo } from "../forgejo/index.ts";
import { register as registerGitHub } from "../github/index.ts";
import { register as registerRepository } from "../repository/index.ts";
import { register as registerReview } from "../review/index.ts";
import { register as registerSystem } from "../system/index.ts";
import { register as registerWaiver } from "../waiver/index.ts";
import { register as registerAnalytics } from "../analytics/index.ts";
import { register as registerMcp } from "../mcp/index.ts";

export type CodedError = ReturnType<typeof requireCodedError>;
export function createApplication({
  applicationVersion,
  backupsPath = BACKUPS_PATH,
  certificateAuthorityPath,
  databasePath,
  loadInstallation = loadInstallationConfiguration,
  validateInstallation = validateInstallationFilesystem,
  validateSources = validateInstallationSources,
  validateTools = validateBundledTools,
  validateCodexAuthentication = validateCodexLogin,
  createReviews,
  createRepositories,
  createGitHubConnections,
  createForgejoConnections,
  createRepositoryGuidance,
  createWaiverAdjudicatorConfiguration,
  createStorageReserve = createStorageReserveGate,
  createEvaluations,
  createCodexRuntime = createCodexExecutionRuntime,
  installationKeyIdentity,
  recoverExecutions = recoverCodexExecutions,
  now = () => Date.now(),
  writeLog = (line) => process.stderr.write(line),
}: {
  applicationVersion?: string;
  backupsPath?: string;
  certificateAuthorityPath?: string;
  databasePath: string;
  loadInstallation?: typeof loadInstallationConfiguration;
  validateInstallation?: typeof validateInstallationFilesystem;
  validateSources?: typeof validateInstallationSources;
  validateTools?: typeof validateBundledTools;
  validateCodexAuthentication?: typeof validateCodexLogin;
  createReviews?: typeof import("../review/review.ts").createReviewService;
  createRepositories?: (...arguments_: any[]) => any;
  createGitHubConnections?: (...arguments_: any[]) => any;
  createForgejoConnections?: (...arguments_: any[]) => any;
  createRepositoryGuidance?: typeof import("../repository/repository-guidance.ts").createRepositoryGuidanceService;
  createWaiverAdjudicatorConfiguration?: typeof import("../waiver/waiver-adjudicator-configuration.ts").createWaiverAdjudicatorConfigurationService;
  createStorageReserve?: typeof createStorageReserveGate;
  createEvaluations?: typeof import("../evaluation/evaluation.ts").createEvaluationService;
  createCodexRuntime?: typeof createCodexExecutionRuntime;
  installationKeyIdentity?: string;
  recoverExecutions?: typeof recoverCodexExecutions;
  now?: () => number;
  writeLog?: (line: string) => unknown;
}) {
  if (typeof databasePath !== "string" || databasePath.length === 0) {
    throw new TypeError("databasePath is required");
  }

  let durableCore: ReturnType<typeof openDurableCore> | null = null;
  const { knownSecrets, registerSecret } = createApplicationSecretRegistry();
  writeLog = createApplicationLog(writeLog, () => durableCore, knownSecrets);
  const deps: Record<string, any> = {};
  const shutdownBoundary = createApplicationShutdownBoundary();
  function stopProductWork(error?: CodedError) {
    deps.githubConnections?.destroy?.();
    deps.forgejoConnections?.destroy?.();
    void deps.codexRuntime?.close();
    void (error ? ioPool.shutdown(error) : ioPool.close());
  }
  const storageBoundary = createHardStorageBoundary(writeLog, stopProductWork);
  const executionRuntime = createApplicationExecutionRuntime({
    certificateAuthorityPath,
    createCodexRuntime,
    now,
    stopIoDuties: stopProductWork,
    storageBoundary,
    writeLog,
  });
  const { ioPool } = executionRuntime;
  let codexCapabilityFailure: CodedError | null = null;
  let releaseInstallationLock: (() => void) | null = null;
  let runtimeKeyIdentity = installationKeyIdentity;

  function releaseStartupResources(error: unknown) {
    const failure = requireCodedError(error);
    void deps.codexRuntime?.close();
    deps.codexRuntime = null;
    deps.evaluations?.destroy?.();
    deps.repositories?.destroy?.();
    deps.githubConnections?.destroy?.();
    deps.forgejoConnections?.destroy?.();
    durableCore?.close();
    durableCore = null;
    releaseInstallationLock?.();
    releaseInstallationLock = null;
    structuredLog(
      writeLog,
      "error",
      "installation_not_ready",
      "configuration",
      "failure",
      failure,
    );
    return failure;
  }

  let browserOrigin;
  let requestSecurity;

  try {
    validateSources();
    const installation = loadInstallation();
    browserOrigin = installation.externalOrigin;
    requestSecurity = createRequestSecurityBoundary(installation);
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    const storageReserve = shutdownBoundary.guardStorageReserve(
      ioPool.createStorageReserve(
        createStorageReserve,
        () => durableCore,
        now,
        installation.freeSpaceReserveBytes,
      ),
    );
    deps.storageReserve = storageReserve;
    durableCore = openDurableCore(databasePath, {
      onStorageUnavailable(error) {
        storageBoundary.enter(requireCodedError(error));
      },
    });
    deps.durableCore = durableCore;
    deps.now = now;
    deps.registerSecret = registerSecret;
    deps.certificateAuthorityPath = certificateAuthorityPath;
    deps.ioPool = ioPool;
    deps.getRepositories = () => deps.repositories;
    deps.getEvaluations = () => deps.evaluations;
    deps.getGitHubConnections = () => deps.githubConnections;
    deps.getForgejoConnections = () => deps.forgejoConnections;
    deps.readCodexCapabilityFailure = () => codexCapabilityFailure;
    deps.validateCodexAuthentication = validateCodexAuthentication;
    Object.assign(deps, registerCodex(null, deps));
    try {
      verifyInstallationKey(durableCore, installation.masterKey);
      runtimeKeyIdentity ??= computeInstallationKeyIdentity(
        installation.masterKey,
      );
      recoverExecutions(durableCore, { now });
      (
        storageReserve as ReturnType<typeof createStorageReserveGate>
      ).cleanupEligibleData();
      deps.externalOrigin = installation.externalOrigin;
      deps.masterKey = installation.masterKey;
      deps.createGitHubConnections = createGitHubConnections;
      deps.createForgejoConnections = createForgejoConnections;
      deps.createRepositories = createRepositories;
      deps.createRepositoryGuidance = createRepositoryGuidance;
      deps.createEvaluations = createEvaluations;
      Object.assign(deps, registerGitHub(null, deps));
      Object.assign(deps, registerForgejo(null, deps));
      Object.assign(deps, registerRepository(null, deps));
      Object.assign(deps, registerEvaluation(null, deps));
    } finally {
      installation.masterKey.fill(0);
    }
    deps.browserSessions = createBrowserSessionService(durableCore, { now });
    deps.implementerTokens = createImplementerTokenService(durableCore, {
      now,
    });
    deps.onboardingTokens = createOnboardingTokenService(durableCore, {
      now,
      registerSecret,
    });
    deps.createReviews = createReviews;
    Object.assign(deps, registerReview(null, deps));
    deps.createWaiverAdjudicatorConfiguration =
      createWaiverAdjudicatorConfiguration;
    Object.assign(deps, registerWaiver(null, deps));
    deps.applicationVersion = applicationVersion;
    deps.backupsPath = backupsPath;
    deps.installationKeyIdentity = runtimeKeyIdentity;
    Object.assign(deps, registerSystem(null, deps));
    Object.assign(deps, registerAnalytics(null, deps));
    Object.assign(deps, registerMcp(null, deps));
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
      deps.codexRuntime = executionRuntime.createCodexRuntime(
        durableCore,
        deps.repositories,
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
    throw releaseStartupResources(error);
  }

  // prettier-ignore
  const requireStorageReserve = requireAvailableStorageReserve.bind(null, storageBoundary, ((deps.storageReserve) as NonNullable<typeof deps.storageReserve>));
  // prettier-ignore
  const readDurableCoreStatus = createDurableCoreStatusReader(storageBoundary, executionRuntime, shutdownBoundary);
  const workerSignal = createWorkerSignal(storageBoundary, shutdownBoundary);

  const server = createApplicationRuntimeServer({
    ...deps,
    browserOrigin,
    requestSecurity,
    readDurableCoreStatus,
    codexCapabilityFailure,
    workerSignal,
    writeLog,
    secureBrowserCookie: browserOrigin.startsWith("https:"),
  });
  deps.githubConnections.startPolling();
  deps.forgejoConnections.startPolling();
  deps.codexRuntime?.start();
  const close = createApplicationClose({
    codexRuntime: deps.codexRuntime ?? null,
    durableCore,
    evaluations: deps.evaluations,
    forgejoConnections: deps.forgejoConnections,
    githubConnections: deps.githubConnections,
    ioPool,
    releaseInstallationLock,
    repositories: deps.repositories,
    server,
    shutdownBoundary,
    writeLog: writeLog as ReturnType<typeof createApplicationLog>,
  });

  return {
    server,
    durableCore,
    implementerTokens: deps.implementerTokens,
    onboardingTokens: deps.onboardingTokens,
    get codexCapability() {
      return readCodexCapability(codexCapabilityFailure);
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
