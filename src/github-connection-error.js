export class GitHubConnectionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {affectedRepositoryIds?: number[], repositoryId?: number}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "GitHubConnectionError";
    this.code = code;
    if (Array.isArray(options?.affectedRepositoryIds)) {
      this.affectedRepositoryIds = options.affectedRepositoryIds;
    }
    if (Number.isSafeInteger(options?.repositoryId)) {
      this.repositoryId = /** @type {number} */ (options?.repositoryId);
    }
  }
}
