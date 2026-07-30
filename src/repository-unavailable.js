/** @param {unknown} error */
export function createUnavailableRepositoryService(error) {
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
    async setLifecycle() {
      throw error;
    },
    destroy() {},
  };
}
