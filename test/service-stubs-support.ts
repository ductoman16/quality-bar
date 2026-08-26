import { failEvaluation } from "../src/evaluation/evaluation-validation.ts";

/** Convenience stub factories for tests that need service dependencies with
 *  method shapes matching production services but that must never be called.
 *  Every method throws the supplied error. These stubs exist only in tests;
 *  production startup fails fast on missing dependencies.
 */

export function stubUnavailableBrowserSessionService(error: unknown) {
  const unavailable = () => {
    throw error;
  };
  return {
    authenticate: unavailable,
    isBootstrapped: unavailable,
    login: unavailable,
    logout: unavailable,
    changePassword: unavailable,
    revokeAll: unavailable,
    touch: unavailable,
    verifyCsrf: unavailable,
  };
}

export function stubUnavailableImplementerTokenService(error: unknown) {
  const unavailable = () => {
    throw error;
  };
  return {
    authenticate: unavailable,
    create: unavailable,
    hasActiveToken: unavailable,
    revoke: unavailable,
    rotate: unavailable,
  };
}

export function stubUnavailableOnboardingTokenService(error: unknown) {
  const unavailable = () => {
    throw error;
  };
  return {
    authenticate: unavailable,
    create: unavailable,
    list: unavailable,
    revoke: unavailable,
    selfRevoke: unavailable,
  };
}

export function stubUnavailableRequestSecurityBoundary(error: unknown) {
  return {
    requestFacts() {
      throw error;
    },
  };
}

export function stubUnavailableRepositoryService(error: unknown) {
  return {
    async acquireGitCredential() {
      throw error;
    },
    list() {
      throw error;
    },
    listPage() {
      throw error;
    },
    async register() {
      throw error;
    },
    async rotateCredential() {
      throw error;
    },
    requireAcceptsNewWork() {
      throw error;
    },
    remove() {
      throw error;
    },
    async resolvePushedSelectors() {
      throw error;
    },
    async resolvePullRequestChangeset() {
      throw error;
    },
    async resolveForgejoPullRequestChangeset() {
      throw error;
    },
    async setLifecycle() {
      throw error;
    },
    destroy() {},
  };
}

export function stubUnavailableRepositoryGuidanceService(error: unknown) {
  return {
    read() {
      throw error;
    },
  };
}

export function stubUnavailableWaiverAdjudicatorConfigurationService(
  error: unknown,
) {
  return {
    read() {
      throw error;
    },
    freezeForAdjudication() {
      throw error;
    },
    update() {
      throw error;
    },
  };
}

export function stubUnavailableGitHubConnectionService(error: unknown) {
  return {
    read() {
      throw error;
    },
    async acquireRepositoryGitCredential() {
      throw error;
    },
    start() {
      throw error;
    },
    startPolling() {},
    stopPolling() {},
    async completeManifest() {
      throw error;
    },
    async completeInstallation() {
      throw error;
    },
    async rotate() {
      throw error;
    },
    async reactivate() {
      throw error;
    },
    async selectRepositories() {
      throw error;
    },
    retire() {
      throw error;
    },
    remove() {
      throw error;
    },
    recordCallbackFailure() {
      throw error;
    },
    consumeCallbackFailure() {
      throw error;
    },
    destroy() {},
  };
}

export function stubUnavailableForgejoConnectionService(
  error: Error & { code?: string },
) {
  return {
    read() {
      throw error;
    },
    acquireRepositoryGitCredential() {
      throw error;
    },
    async discover() {
      throw error;
    },
    async connect() {
      throw error;
    },
    async rotate() {
      throw error;
    },
    async prepareRepositoryEnablement() {
      throw error;
    },
    async reactivate() {
      throw error;
    },
    retire() {
      throw error;
    },
    remove() {
      throw error;
    },
    async runPolling() {
      throw error;
    },
    async publishWaiting() {
      throw error;
    },
    requireFreshBaseline() {
      throw error;
    },
    startPolling() {},
    stopPolling() {},
    destroy() {},
  };
}

export function stubUnavailableReviewService(error: unknown) {
  function unavailable(): never {
    throw error;
  }
  return {
    create: unavailable,
    createForRepository: unavailable,
    list: unavailable,
    read: unavailable,
    reactivateVersion: unavailable,
    remove: unavailable,
    saveVersion: unavailable,
    selectForNewEvaluation: unavailable,
    setArchived: unavailable,
    setAssignment: unavailable,
    setForRepository: unavailable,
    updateMetadata: unavailable,
  };
}

export function stubUnavailableEvaluationService(error: unknown) {
  const failure =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? { code: error.code, message: error.message }
      : {
          code: "evaluation_capability_unavailable",
          message: "Evaluation capability is unavailable",
        };
  return {
    admitAutomatic() {
      failEvaluation(failure.code, failure.message, error);
    },
    cancel() {
      failEvaluation(failure.code, failure.message, error);
    },
    destroy() {},
    async createExplicit() {
      failEvaluation(failure.code, failure.message, error);
    },
    list() {
      failEvaluation(failure.code, failure.message, error);
    },
    read() {
      failEvaluation(failure.code, failure.message, error);
    },
    readAnalytics() {
      failEvaluation(failure.code, failure.message, error);
    },
    readResult() {
      failEvaluation(failure.code, failure.message, error);
    },
    readWaiverAdjudication() {
      failEvaluation(failure.code, failure.message, error);
    },
    readWaiverDecision() {
      failEvaluation(failure.code, failure.message, error);
    },
    readWaiverRequest() {
      failEvaluation(failure.code, failure.message, error);
    },
    readWaiverAdjudications() {
      failEvaluation(failure.code, failure.message, error);
    },
    readFinding() {
      failEvaluation(failure.code, failure.message, error);
    },
    readFindingById() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRun() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRunById() {
      failEvaluation(failure.code, failure.message, error);
    },
    readReviewRunDiagnostics() {
      failEvaluation(failure.code, failure.message, error);
    },
    recoverWaiverAdjudication() {
      failEvaluation(failure.code, failure.message, error);
    },
    retryWaiverErrors() {
      failEvaluation(failure.code, failure.message, error);
    },
    retryPreStart() {
      failEvaluation(failure.code, failure.message, error);
    },
    submitWaiverBatch() {
      failEvaluation(failure.code, failure.message, error);
    },
  };
}
