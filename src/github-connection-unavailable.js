/** @param {unknown} error */
export function createUnavailableGitHubConnectionService(error) {
  return {
    read() {
      throw error;
    },
    start() {
      throw error;
    },
    startPolling() {},
    async completeManifest() {
      throw error;
    },
    async completeInstallation() {
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
