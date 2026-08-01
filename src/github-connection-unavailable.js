/** @param {unknown} error */
export function createUnavailableGitHubConnectionService(error) {
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
