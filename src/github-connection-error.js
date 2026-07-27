export class GitHubConnectionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {affectedRepositoryIds?: number[], completedRepositoryIds?: number[], repositoryEvidence?: unknown[], repositoryId?: number}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "GitHubConnectionError";
    this.code = code;
    if (Array.isArray(options?.affectedRepositoryIds)) {
      this.affectedRepositoryIds = options.affectedRepositoryIds;
    }
    if (Array.isArray(options?.completedRepositoryIds)) {
      this.completedRepositoryIds = options.completedRepositoryIds;
    }
    if (Array.isArray(options?.repositoryEvidence)) {
      this.repositoryEvidence = options.repositoryEvidence;
    }
    if (Number.isSafeInteger(options?.repositoryId)) {
      this.repositoryId = /** @type {number} */ (options?.repositoryId);
    }
  }
}
