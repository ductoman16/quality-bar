export class GitHubConnectionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {affectedRepositoryIds?: number[], commit?: (transaction: any) => void, completedRepositoryIds?: number[], nextAttemptAt?: number, repositoryEvidence?: unknown[], repositoryId?: number, responseStatus?: number}} [options]
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
    if (typeof options?.commit === "function") {
      this.commit = options.commit;
    }
    if (Array.isArray(options?.repositoryEvidence)) {
      this.repositoryEvidence = options.repositoryEvidence;
    }
    if (Number.isSafeInteger(options?.repositoryId)) {
      this.repositoryId = /** @type {number} */ (options?.repositoryId);
    }
    if (Number.isSafeInteger(options?.nextAttemptAt)) {
      this.nextAttemptAt = /** @type {number} */ (options?.nextAttemptAt);
    }
    if (Number.isSafeInteger(options?.responseStatus)) {
      this.responseStatus = /** @type {number} */ (options?.responseStatus);
    }
  }
}

/** @param {string} code @param {string} message @param {unknown} [cause] @returns {never} */
export function failGitHubConnection(code, message, cause) {
  throw new GitHubConnectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
