/** @param {unknown} error */
export function createUnavailableRepositoryService(error) {
  return {
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
