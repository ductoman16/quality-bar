export class GitHubConnectionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {repositoryId?: number}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "GitHubConnectionError";
    this.code = code;
    if (Number.isSafeInteger(options?.repositoryId)) {
      this.repositoryId = /** @type {number} */ (options?.repositoryId);
    }
  }
}
